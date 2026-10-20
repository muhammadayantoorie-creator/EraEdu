import { supabase } from '../config/supabase';

export type ViolationType =
  | 'tab_change'
  | 'copy_attempt'
  | 'right_click'
  | 'screenshot_attempt'
  | 'keyboard_shortcut'
  | 'face_away'
  | 'no_face'
  | 'focus_loss'
  | 'window_resize'
  | 'fullscreen_exit'
  | 'picture_in_picture'
  | 'automation_detected'
  | 'TAB_SWITCH'
  | 'SYSTEM_FOCUS_LOST'
  | 'RESTRICTED_KEY'
  | 'FACE_AWAY'
  | 'NO_FACE';
export type Severity = 'low' | 'medium' | 'high';

interface ViolationInput {
  quizAttemptId: string;
  studentId: string;
  quizId: string;
  teacherId?: string;
  violationType: ViolationType;
  detectionMethod: string;
  severity?: Severity;
  eventId?: string;
  details?: {
    windowFocused?: boolean;
    userAgent?: string;
    ipAddress?: string;
    eventTimestamp?: string;
    alertMessage?: string;
    durationSeconds?: number;
    payloadMetaData?: {
      ip?: string;
      user_agent?: string;
      key_name?: string;
      focus_state?: string;
    };
  };
}

const canonicalViolationTypes: Record<string, ViolationType> = {
  TAB_SWITCH: 'tab_change', tab_switch: 'tab_change', tab_change: 'tab_change',
  SYSTEM_FOCUS_LOST: 'focus_loss', focus_loss: 'focus_loss',
  RESTRICTED_KEY: 'keyboard_shortcut', keyboard_shortcut: 'keyboard_shortcut',
  FACE_AWAY: 'face_away', face_away: 'face_away', NO_FACE: 'no_face', no_face: 'no_face',
};

export function normalizeViolationType(value: string): ViolationType {
  if (typeof value !== 'string' || !value.trim() || value.length > 50) {
    throw Object.assign(new Error('A valid integrity event type is required'), { statusCode: 400 });
  }
  return canonicalViolationTypes[value] || (value.toLowerCase() as ViolationType);
}

function missingColumn(error: any, columns: string[]): boolean {
  if (!['42703', 'PGRST204'].includes(error?.code)) return false;
  const description = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return columns.some(column => new RegExp(`\\b${column}\\b`).test(description));
}

function monitoringMigrationRequired(error: any, atomicWriter = false): Error | null {
  const missingEventIndex = atomicWriter && error?.code === '42P10' &&
    /on conflict/i.test(String(error?.message || ''));
  if (missingColumn(error, ['event_id', 'violation_count', 'violations']) || missingEventIndex) {
    return Object.assign(new Error('Monitoring schema migration required: apply backend/migrations/019_make_cheating_events_authoritative.sql'), { statusCode: 503 });
  }
  return null;
}

function teacherAttemptMigrationRequired(error: any): Error | null {
  const message = String(error?.message || '').toLowerCase();
  const missingWriter = ['42883', 'PGRST202'].includes(error?.code) &&
    /\breport_teacher_violation\b/.test(message);
  if (
    missingColumn(error, ['teacher_quiz_snapshot', 'teacher_question_state', 'teacher_answers_finalized_at']) ||
    missingWriter || message.includes('teacher exam timing migration')
  ) {
    return Object.assign(
      new Error('Teacher exam timing is unavailable. An administrator must apply backend/migrations/027_teacher_attempt_deadlines.sql.'),
      { statusCode: 503 },
    );
  }
  return null;
}

export const cheatingViolationService = {
  // Report a new violation
  async reportViolation(input: ViolationInput) {
    const normalizedType = normalizeViolationType(input.violationType);
    if (typeof input.eventId !== 'string' || !input.eventId.trim() || input.eventId.length > 200) {
      throw Object.assign(new Error('A stable event ID is required to retry integrity reports safely'), { statusCode: 400 });
    }
    if (typeof input.detectionMethod !== 'string' || !input.detectionMethod.trim() || input.detectionMethod.length > 100) {
      throw Object.assign(new Error('A valid detection method is required'), { statusCode: 400 });
    }
    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('id, quiz_id, status, topic_id, teacher_quiz_snapshot')
      .eq('id', input.quizAttemptId)
      .eq('user_id', input.studentId)
      .single();

    if (attemptError || !attempt) throw teacherAttemptMigrationRequired(attemptError) || new Error('Exam attempt not found');
    // Teacher code-exam events and finalization must share one database lock.
    // This prevents a threshold report racing a browser submit and losing
    // answers that were already persisted before the event.
    if (!attempt.topic_id && attempt.teacher_quiz_snapshot) {
      const { data, error } = await supabase.rpc('report_teacher_violation', {
        p_student_id: input.studentId,
        p_attempt_id: input.quizAttemptId,
        p_event: {
          violationType: normalizedType,
          eventId: input.eventId || null,
          detectionMethod: input.detectionMethod || 'browser_event',
          severity: input.severity || 'low',
          details: input.details || {},
        },
      });
      if (error || !data) throw monitoringMigrationRequired(error, true) ||
        teacherAttemptMigrationRequired(error) || new Error(error?.message || 'Could not save integrity event');
      return data;
    }

    if (!attempt.topic_id && attempt.status === 'in-progress') {
      throw teacherAttemptMigrationRequired({ message: 'Teacher exam timing migration is required' });
    }
    if (attempt.status !== 'in-progress') {
      // A hidden/unread count is not a factual zero.
      return { violationId: null, autoSubmitted: false, alreadySubmitted: true };
    }

    const { data: quiz } = await supabase
      .from('teacher_quizzes')
      .select('violation_limit, teacher_id')
      .eq('id', attempt.quiz_id)
      .single();
    const violationLimit = Math.min(100, Math.max(1, Number(quiz?.violation_limit) || 3));

    const row = {
      quiz_attempt_id: input.quizAttemptId,
      student_id: input.studentId,
      quiz_id: attempt.quiz_id,
      teacher_id: quiz?.teacher_id || null,
      violation_type: normalizedType,
      detection_method: input.detectionMethod,
      severity: input.severity || 'low',
      details: input.details || {},
      timestamp: input.details?.eventTimestamp || new Date().toISOString(),
      event_id: input.eventId || null,
    };
    let { data: violation, error } = await supabase
      .from('cheating_violations')
      .insert([row])
      .select()
      .single();
    if (error?.code === '23505' && input.eventId) {
      ({ data: violation, error } = await supabase.from('cheating_violations')
        .select('*').eq('quiz_attempt_id', input.quizAttemptId).eq('event_id', input.eventId).single());
    }
    if (error) throw monitoringMigrationRequired(error) || new Error(error.message);

    // Get updated violation count
    const { count, error: countError } = await supabase
      .from('cheating_violations')
      .select('*', { count: 'exact', head: true })
      .eq('quiz_attempt_id', input.quizAttemptId);

    if (countError) throw monitoringMigrationRequired(countError) || new Error(countError.message);
    if (count === null) throw new Error('Could not confirm integrity event count');
    const currentCount = count;

    // Update the attempt and auto-submit as soon as the teacher's limit is reached.
    // The status predicate prevents duplicate completion during concurrent reports.
    const shouldAutoSubmit = currentCount >= violationLimit;
    const updateData: any = { 
      violation_count: currentCount 
    };

    if (shouldAutoSubmit) {
      updateData.status = 'completed';
      updateData.completed_at = new Date().toISOString();
      updateData.auto_submitted = true;
      updateData.submission_reason = 'excessive_violations';
    }

    let updateQuery = supabase
      .from('quiz_attempts')
      .update(updateData)
      .eq('id', input.quizAttemptId);
    if (shouldAutoSubmit) updateQuery = updateQuery.eq('status', 'in-progress');
    const { error: updateError } = await updateQuery;
    if (updateError) throw monitoringMigrationRequired(updateError) || new Error(updateError.message);

    return {
      violationId: violation.id,
      violationCount: currentCount,
      violationLimit,
      autoSubmitted: shouldAutoSubmit,
      remainingViolations: Math.max(0, violationLimit - currentCount),
    };
  },

  // Get violations for an attempt
  async getViolationsForAttempt(attemptId: string, requesterId: string, requesterRole: string) {
    // First get the attempt to verify access
    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .select('user_id, quiz_id')
      .eq('id', attemptId)
      .single();

    if (!attempt) {
      throw new Error('Exam attempt not found');
    }

    if (requesterRole === 'student') {
      // Match the result DTO policy: integrity detail is for authorized
      // teacher/admin review, including when a student owns the attempt.
      throw Object.assign(new Error('Integrity details are available to authorized reviewers only'), { statusCode: 403 });
    } else if (requesterRole !== 'admin') {
      const { data: quiz } = await supabase
        .from('teacher_quizzes')
        .select('teacher_id')
        .eq('id', attempt.quiz_id)
        .single();
      if (!quiz || quiz.teacher_id !== requesterId) {
        throw Object.assign(new Error('You are not authorized to view these violations'), { statusCode: 403 });
      }
    }

    // Get violations
    const { data: violations, error } = await supabase
      .from('cheating_violations')
      .select('*')
      .eq('quiz_attempt_id', attemptId)
      .order('timestamp', { ascending: true });

    if (error) throw new Error(error.message);

    return (violations || []).map(v => ({
      type: v.violation_type || 'unknown',
      timestamp: v.timestamp,
      severity: v.severity || 'low',
      detectionMethod: v.detection_method || 'unknown',
      eventId: v.event_id || undefined,
      details: v.details ?? null,
    }));
  },

  // Get violation summary for teacher dashboard
  async getViolationSummary(teacherId: string, quizId?: string) {
    // Event.teacher_id records who managed the exam at detection time. Access
    // follows the exam's current manager after a course reassignment.
    const { data: ownedQuizzes, error: quizError } = await supabase
      .from('teacher_quizzes')
      .select('id')
      .eq('teacher_id', teacherId);
    if (quizError) throw new Error(quizError.message);
    const ownedIds = (ownedQuizzes || []).map((quiz: any) => quiz.id);
    let data: any[] = [];
    if (ownedIds.length && (!quizId || ownedIds.includes(quizId))) {
      const result = await supabase
        .from('cheating_violations')
        .select(`
          *,
          quiz_attempts:quiz_attempt_id (
            user_id,
            topic_id,
            score,
            max_score
          )
        `)
        .in('quiz_id', quizId ? [quizId] : ownedIds)
        .order('timestamp', { ascending: false });
      if (result.error) throw new Error(result.error.message);
      data = result.data || [];
    }

    // Group by attempt and calculate stats
    const attemptViolations: Record<string, any> = {};
    (data || []).forEach((v: any) => {
      if (!attemptViolations[v.quiz_attempt_id]) {
        attemptViolations[v.quiz_attempt_id] = {
          attemptId: v.quiz_attempt_id,
          violations: [],
          totalCount: 0
        };
      }
      attemptViolations[v.quiz_attempt_id].violations.push(v);
      attemptViolations[v.quiz_attempt_id].totalCount++;
    });

    return {
      totalViolations: data?.length || 0,
      suspiciousAttempts: Object.keys(attemptViolations).length,
      byType: {
        tab_change: data?.filter(v => v.violation_type === 'tab_change').length || 0,
        TAB_SWITCH: data?.filter(v => v.violation_type === 'TAB_SWITCH').length || 0,
        SYSTEM_FOCUS_LOST: data?.filter(v => v.violation_type === 'SYSTEM_FOCUS_LOST').length || 0,
        RESTRICTED_KEY: data?.filter(v => v.violation_type === 'RESTRICTED_KEY').length || 0,
        copy_attempt: data?.filter(v => v.violation_type === 'copy_attempt').length || 0,
        screenshot_attempt: data?.filter(v => v.violation_type === 'screenshot_attempt').length || 0,
        keyboard_shortcut: data?.filter(v => v.violation_type === 'keyboard_shortcut').length || 0,
        right_click: data?.filter(v => v.violation_type === 'right_click').length || 0,
        focus_loss: data?.filter(v => v.violation_type === 'focus_loss').length || 0,
        window_resize: data?.filter(v => v.violation_type === 'window_resize').length || 0,
        fullscreen_exit: data?.filter(v => v.violation_type === 'fullscreen_exit').length || 0,
        picture_in_picture: data?.filter(v => v.violation_type === 'picture_in_picture').length || 0,
        automation_detected: data?.filter(v => v.violation_type === 'automation_detected').length || 0
      },
      attempts: Object.values(attemptViolations)
    };
  },

  // Flag an attempt as suspicious
  async flagAttempt(attemptId: string, teacherId: string, requesterRole: string) {
    await this.assertAttemptManagementAccess(attemptId, teacherId, requesterRole);
    const { data, error } = await supabase
      .from('quiz_attempts')
      .update({ is_flagged: true })
      .eq('id', attemptId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  },

  // Invalidate an attempt
  async invalidateAttempt(attemptId: string, teacherId: string, requesterRole: string) {
    await this.assertAttemptManagementAccess(attemptId, teacherId, requesterRole);
    const { data, error } = await supabase
      .from('quiz_attempts')
      .update({ 
        status: 'invalidated',
        is_flagged: true
      })
      .eq('id', attemptId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  },

  async assertAttemptManagementAccess(attemptId: string, requesterId: string, requesterRole: string) {
    if (requesterRole === 'admin') return;
    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('quiz_id')
      .eq('id', attemptId)
      .single();
    if (attemptError || !attempt) throw Object.assign(new Error('Exam attempt not found'), { statusCode: 404 });

    const { data: quiz } = await supabase
      .from('teacher_quizzes')
      .select('teacher_id')
      .eq('id', attempt.quiz_id)
      .single();
    if (!quiz || quiz.teacher_id !== requesterId) {
      throw Object.assign(new Error('Not authorized to manage this attempt'), { statusCode: 403 });
    }
  },
};
