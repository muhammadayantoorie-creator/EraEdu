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

export const cheatingViolationService = {
  // Report a new violation
  async reportViolation(input: ViolationInput) {
    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('id, quiz_id, status')
      .eq('id', input.quizAttemptId)
      .eq('user_id', input.studentId)
      .single();

    if (attemptError || !attempt) throw new Error('Quiz attempt not found');
    if (attempt.status !== 'in-progress') {
      return { violationId: null, violationCount: 0, violationLimit: 0, autoSubmitted: false, alreadySubmitted: true };
    }

    const { data: quiz } = await supabase
      .from('teacher_quizzes')
      .select('violation_limit, teacher_id')
      .eq('id', attempt.quiz_id)
      .single();
    const violationLimit = Math.min(100, Math.max(1, Number(quiz?.violation_limit) || 3));

    const { data: violation, error } = await supabase
      .from('cheating_violations')
      .insert([{
        quiz_attempt_id: input.quizAttemptId,
        student_id: input.studentId,
        quiz_id: attempt.quiz_id,
        teacher_id: quiz?.teacher_id || null,
        violation_type: input.violationType,
        detection_method: input.detectionMethod,
        severity: input.severity || 'low',
        details: input.details || {},
        timestamp: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Get updated violation count
    const { count } = await supabase
      .from('cheating_violations')
      .select('*', { count: 'exact', head: true })
      .eq('quiz_attempt_id', input.quizAttemptId);

    const currentCount = count || 1;

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
    if (updateError) throw new Error(updateError.message);

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
      throw new Error('Quiz attempt not found');
    }

    if (requesterRole === 'student') {
      if (attempt.user_id !== requesterId) {
        throw Object.assign(new Error('You are not authorized to view these violations'), { statusCode: 403 });
      }
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

    return violations.map(v => ({
      type: v.violation_type || 'unknown',
      timestamp: v.timestamp,
      details: typeof v.details === 'string' ? v.details : JSON.stringify(v.details)
    }));
  },

  // Get violation summary for teacher dashboard
  async getViolationSummary(teacherId: string, quizId?: string) {
    let query = supabase
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
      .eq('teacher_id', teacherId);

    if (quizId) {
      query = query.eq('quiz_id', quizId);
    }

    const { data, error } = await query.order('timestamp', { ascending: false });

    if (error) throw new Error(error.message);

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
    if (attemptError || !attempt) throw Object.assign(new Error('Quiz attempt not found'), { statusCode: 404 });

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
