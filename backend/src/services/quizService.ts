import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { assertStudentEmailPolicy } from './authService';
import { aiService } from './aiService';

interface QuizQuestion {
  text: string;
  options: string[];
  correctAnswer: number;
  difficulty: string;
  explanation?: string;
  timeLimit?: number;
  questionType?: 'multipleChoice' | 'shortAnswer';
  answerText?: string;
}

interface QuizData {
  title: string;
  description?: string;
  timeLimit?: number;
  scheduledStart?: string;
  courseId?: string;
  questions: QuizQuestion[];
  bankQuestionIds?: string[];
  cameraMonitoring?: boolean;
  violationLimit?: number;
}

// PostgREST returns 42703 / "column ... does not exist" when a referenced
// column is missing. We use this to fall back gracefully when an optional
// migration hasn't been applied yet.
function isMissingColumnError(err: any, column: string): boolean {
  if (!err) return false;
  const msg: string = err.message || '';
  const details: string = err.details || '';
  const haystack = `${msg} ${details}`.toLowerCase();
  return (
    err.code === '42703' ||
    haystack.includes(`column "${column}"`) ||
    haystack.includes(`'${column}' column`) ||
    haystack.includes(`column ${column} does not exist`) ||
    haystack.includes(`could not find the '${column}'`)
  );
}

type PersistedViolation = { type: string; timestamp: string; details?: unknown; eventId?: string; severity?: string; detectionMethod?: string };
async function persistedViolationsForAttempts(attemptIds: string[]): Promise<Map<string, PersistedViolation[]>> {
  const result = new Map<string, PersistedViolation[]>();
  if (!attemptIds.length) return result;
  const { data, error } = await supabase.from('cheating_violations')
    .select('quiz_attempt_id, violation_type, timestamp, details, event_id, severity, detection_method')
    .in('quiz_attempt_id', attemptIds).order('timestamp', { ascending: true });
  if (error) {
    if (isMissingColumnError(error, 'event_id')) {
      throw Object.assign(new Error('Monitoring schema migration required: apply backend/migrations/019_make_cheating_events_authoritative.sql'), { statusCode: 503 });
    }
    throw new Error(error.message);
  }
  for (const event of data || []) {
    const events = result.get(event.quiz_attempt_id) || [];
    events.push({ type: event.violation_type || 'unknown', timestamp: event.timestamp, details: event.details, eventId: event.event_id || undefined, severity: event.severity || 'low', detectionMethod: event.detection_method || 'unknown' });
    result.set(event.quiz_attempt_id, events);
  }
  return result;
}

const MAX_TITLE_LEN = 200;
const MAX_DESCRIPTION_LEN = 2000;

// Every attempt receives a stable, server-derived variant. It changes the
// order of questions and multiple-choice options for different students,
// while remaining identical if a student refreshes or resumes the attempt.
// We retain the original question id so submissions can still be graded
// authoritatively by the server.
function stableShuffle<T>(items: T[], seed: string): T[] {
  const result = [...items];
  let counter = 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    const digest = crypto.createHash('sha256').update(`${seed}:${counter++}`).digest();
    const target = digest.readUInt32BE(0) % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function questionOrderForAttempt(questionCount: number, attemptId: string): number[] {
  return stableShuffle(Array.from({ length: questionCount }, (_, index) => index), `${attemptId}:questions`);
}

export function optionOrderForAttempt(optionCount: number, attemptId: string, questionIndex: number): number[] {
  return stableShuffle(Array.from({ length: optionCount }, (_, index) => index), `${attemptId}:question:${questionIndex}:options`);
}

type SubmittedAttemptAnswer = { questionId: string; selectedAnswer: number | string };

export interface SavedAttemptAnswer {
  questionId: string;
  // Multiple-choice answers are always saved as the canonical option index.
  // Short answers remain text for teacher review.
  selectedAnswer: number | string | null;
  isCorrect: boolean;
  questionType?: 'multipleChoice' | 'shortAnswer';
  answerVersion: 2;
}

function submissionError(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function questionIndexFromId(questionId: unknown, quizId: string): number {
  if (typeof questionId !== 'string') throw submissionError('Each answer must include a question ID');
  const marker = questionId.lastIndexOf('-q');
  if (marker < 1 || questionId.slice(0, marker) !== quizId) {
    throw submissionError('Answer question ID does not belong to this quiz');
  }
  const suffix = questionId.slice(marker + 2);
  if (!/^\d+$/.test(suffix)) throw submissionError('Answer question ID is invalid');
  return Number(suffix);
}

// Convert the browser's displayed option position to the canonical question
// option index exactly once. The normalized result is used for scoring,
// persistence, and every review response.
export function normalizeAttemptAnswers(
  quizId: string,
  attemptId: string,
  questions: QuizQuestion[],
  submittedAnswers: SubmittedAttemptAnswer[],
): { answers: SavedAttemptAnswer[]; score: number } {
  if (!Array.isArray(submittedAnswers)) throw submissionError('Answers must be an array');

  const answeredQuestions = new Set<number>();
  let score = 0;
  const answers = submittedAnswers.map((answer) => {
    if (!answer || typeof answer !== 'object') throw submissionError('Each answer must be an object');
    const questionIndex = questionIndexFromId(answer.questionId, quizId);
    const question = questions[questionIndex];
    if (!question) throw submissionError('Answer references an unknown question');
    if (answeredQuestions.has(questionIndex)) throw submissionError('Each question can only be answered once');
    answeredQuestions.add(questionIndex);

    const isShortAnswer = question.questionType === 'shortAnswer' || !question.options || question.options.length === 0;
    if (isShortAnswer) {
      if (typeof answer.selectedAnswer !== 'string') {
        throw submissionError('Short-answer responses must be text');
      }
      const submitted = answer.selectedAnswer.trim().toLowerCase();
      const expected = String(question.answerText ?? '').trim().toLowerCase();
      const isCorrect = Boolean(submitted && expected && submitted === expected);
      if (isCorrect) score++;
      return {
        questionId: `${quizId}-q${questionIndex}`,
        selectedAnswer: answer.selectedAnswer,
        isCorrect,
        questionType: 'shortAnswer' as const,
        answerVersion: 2 as const,
      };
    }

    const displayedOptionIndex = Number(answer.selectedAnswer);
    // -1 is the browser's explicit unanswered sentinel. It is retained as a
    // null canonical answer so review has a row but it never earns a point.
    if (displayedOptionIndex === -1) {
      return {
        questionId: `${quizId}-q${questionIndex}`,
        selectedAnswer: null,
        isCorrect: false,
        questionType: 'multipleChoice' as const,
        answerVersion: 2 as const,
      };
    }
    if (!Number.isInteger(displayedOptionIndex) || displayedOptionIndex < 0 || displayedOptionIndex >= question.options.length) {
      throw submissionError('Selected option is out of range');
    }

    const selectedAnswer = optionOrderForAttempt(question.options.length, attemptId, questionIndex)[displayedOptionIndex];
    const isCorrect = selectedAnswer === question.correctAnswer;
    if (isCorrect) score++;
    return {
      questionId: `${quizId}-q${questionIndex}`,
      selectedAnswer,
      isCorrect,
      questionType: 'multipleChoice' as const,
      answerVersion: 2 as const,
    };
  });

  return { answers, score };
}

// Older attempts saved the displayed option position. Normalize them only in
// review responses so historic teacher views remain accurate without trusting
// the browser or rewriting assessment records.
function answersForReview(attempt: { id: string; answers?: any[] }, quiz: { id: string; questions?: QuizQuestion[] }): SavedAttemptAnswer[] {
  const questions = quiz.questions || [];
  return (Array.isArray(attempt.answers) ? attempt.answers : []).map((answer: any) => {
    try {
      const questionIndex = questionIndexFromId(answer?.questionId, quiz.id);
      const question = questions[questionIndex];
      if (!question) throw new Error('Unknown question');
      if (answer?.answerVersion === 2) return answer as SavedAttemptAnswer;

      const isShortAnswer = question.questionType === 'shortAnswer' || !question.options || question.options.length === 0;
      if (isShortAnswer) {
        const submitted = String(answer?.selectedAnswer ?? '').trim().toLowerCase();
        const expected = String(question.answerText ?? '').trim().toLowerCase();
        return { questionId: `${quiz.id}-q${questionIndex}`, selectedAnswer: String(answer?.selectedAnswer ?? ''), isCorrect: Boolean(submitted && expected && submitted === expected), questionType: 'shortAnswer', answerVersion: 2 };
      }

      const displayedOptionIndex = Number(answer?.selectedAnswer);
      const selectedAnswer = Number.isInteger(displayedOptionIndex) && displayedOptionIndex >= 0 && displayedOptionIndex < question.options.length
        ? optionOrderForAttempt(question.options.length, attempt.id, questionIndex)[displayedOptionIndex]
        : null;
      return { questionId: `${quiz.id}-q${questionIndex}`, selectedAnswer, isCorrect: selectedAnswer === question.correctAnswer, questionType: 'multipleChoice', answerVersion: 2 };
    } catch {
      return { questionId: String(answer?.questionId ?? ''), selectedAnswer: null, isCorrect: false, answerVersion: 2 };
    }
  });
}
const MAX_QUESTIONS = 200;
const MAX_QUESTION_TEXT_LEN = 2000;
const MAX_OPTION_LEN = 500;
const MAX_OPTIONS = 10;

export function snapshotBankQuestion(row: any): QuizQuestion {
  const questionType = row.question_type || 'multipleChoice';
  if (questionType !== 'multipleChoice' && questionType !== 'shortAnswer') {
    throw submissionError('Selected bank question has an unsupported type');
  }
  const options = row.options;
  if (questionType === 'multipleChoice' && (
    !Array.isArray(options) || options.length < 2 || options.length > MAX_OPTIONS ||
    options.some((option: unknown) => typeof option !== 'string' || !option.trim()) ||
    !Number.isInteger(row.correct_answer) || row.correct_answer < 0 || row.correct_answer >= options.length
  )) {
    throw submissionError('Selected bank question has incompatible options or answer');
  }
  return {
    text: row.content || row.question_text,
    options: questionType === 'shortAnswer' ? [] : [...options],
    correctAnswer: questionType === 'shortAnswer' ? -1 : row.correct_answer,
    questionType,
    answerText: questionType === 'shortAnswer' ? String(row.correct_answers?.[0] || '') : undefined,
    difficulty: row.difficulty || 'Medium',
    explanation: row.explanation || row.hint || '',
    timeLimit: Number.isInteger(row.time_limit) && row.time_limit > 0 ? row.time_limit : 60,
  };
}

type TopicSnapshotQuestion = {
  id: string;
  text: string;
  options: string[];
  correctAnswer: number;
  difficulty: string;
  timeLimit: number;
};

function topicSnapshotQuestion(row: any): TopicSnapshotQuestion {
  if (!row?.id || typeof (row.content || row.question_text) !== 'string' || !(row.content || row.question_text).trim()) {
    throw submissionError('Topic question has no usable text');
  }
  const question = snapshotBankQuestion(row);
  if (question.questionType !== 'multipleChoice') throw submissionError('Topic exam requires multiple-choice questions');
  return {
    id: row.id,
    text: question.text,
    options: question.options,
    correctAnswer: question.correctAnswer,
    difficulty: question.difficulty,
    timeLimit: question.timeLimit || 60,
  };
}

function topicRemainingSeconds(attempt: { started_at: string; answers?: any[] }, question: TopicSnapshotQuestion, overallMinutes?: number | null) {
  const lastAnswer = Array.isArray(attempt.answers) ? attempt.answers[attempt.answers.length - 1] : null;
  const activatedAt = new Date(lastAnswer?.answeredAt || attempt.started_at).getTime();
  const questionDeadline = activatedAt + question.timeLimit * 1000;
  const overallDeadline = overallMinutes && overallMinutes > 0
    ? new Date(attempt.started_at).getTime() + overallMinutes * 60_000
    : Infinity;
  return Math.max(0, Math.ceil((Math.min(questionDeadline, overallDeadline) - Date.now()) / 1000));
}

function publicTopicQuestion(question: TopicSnapshotQuestion, remainingSeconds: number) {
  return { _id: question.id, content: question.text, options: question.options, difficulty: question.difficulty, timeLimit: question.timeLimit, remainingSeconds };
}

function topicError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function validateQuizPayload(data: QuizData) {
  const err = (m: string) => Object.assign(new Error(m), { statusCode: 400 });
  if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
    throw err('Exam title is required');
  }
  if (data.title.length > MAX_TITLE_LEN) throw err(`Title must be at most ${MAX_TITLE_LEN} characters`);
  if (data.description && data.description.length > MAX_DESCRIPTION_LEN) {
    throw err(`Description must be at most ${MAX_DESCRIPTION_LEN} characters`);
  }
  if (data.timeLimit !== undefined && data.timeLimit !== null) {
    if (typeof data.timeLimit !== 'number' || data.timeLimit < 1 || data.timeLimit > 600) {
      throw err('Time limit must be between 1 and 600 minutes');
    }
  }
  if (data.violationLimit !== undefined && (!Number.isInteger(data.violationLimit) || data.violationLimit < 1 || data.violationLimit > 100)) {
    throw err('Violation limit must be a whole number between 1 and 100');
  }
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw err('Exam must contain at least one question');
  }
  if (data.questions.length > MAX_QUESTIONS) {
    throw err(`Exam cannot have more than ${MAX_QUESTIONS} questions`);
  }
  data.questions.forEach((q, i) => {
    if (!q.text || typeof q.text !== 'string' || q.text.trim().length === 0) {
      throw err(`Question ${i + 1}: text is required`);
    }
    if (q.text.length > MAX_QUESTION_TEXT_LEN) {
      throw err(`Question ${i + 1}: text exceeds ${MAX_QUESTION_TEXT_LEN} characters`);
    }
    const isShortAnswer = q.questionType === 'shortAnswer';
    if (!isShortAnswer) {
      if (!Array.isArray(q.options) || q.options.length < 2) {
        throw err(`Question ${i + 1}: must have at least 2 options`);
      }
      if (q.options.length > MAX_OPTIONS) {
        throw err(`Question ${i + 1}: at most ${MAX_OPTIONS} options allowed`);
      }
      if (q.options.some((o) => typeof o !== 'string' || o.length > MAX_OPTION_LEN)) {
        throw err(`Question ${i + 1}: option exceeds ${MAX_OPTION_LEN} characters`);
      }
      if (
        typeof q.correctAnswer !== 'number' ||
        q.correctAnswer < 0 ||
        q.correctAnswer >= q.options.length
      ) {
        throw err(`Question ${i + 1}: correctAnswer index is out of range`);
      }
    } else {
      // Short-answer questions are teacher-graded; no expected answer required.
      if (q.answerText && typeof q.answerText !== 'string') {
        throw err(`Question ${i + 1}: answerText must be a string`);
      }
    }
  });
}

export const quizService = {
  // Generate a unique 4-digit access code. Cryptographically random to avoid
  // predictability; uses maybeSingle() so a no-row response is not treated as
  // an error. The 9000-key space is small — pair with a UNIQUE constraint on
  // teacher_quizzes.access_code so a race between two creators surfaces as a
  // DB error instead of silently overwriting.
  async generateUniqueCode(): Promise<string> {
    const randomCode = () => {
      const n = crypto.randomInt(1000, 10000);
      return n.toString();
    };
    const maxAttempts = 25;

    for (let i = 0; i < maxAttempts; i++) {
      const code = randomCode();
      const { data: existing } = await supabase
        .from('teacher_quizzes')
        .select('id')
        .eq('access_code', code)
        .maybeSingle();
      if (!existing) return code;
    }

    throw new Error('Failed to generate unique code. Please try again.');
  },

  // Send notification only to students enrolled in the quiz course
  async notifyCourseStudents(quizTitle: string, quizId: string, accessCode: string, teacherId: string, courseId: string, scheduledStart?: string) {
    // Get teacher name
    const { data: teacher } = await supabase
      .from('users')
      .select('name')
      .eq('id', teacherId)
      .single();

    const { data: course } = await supabase
      .from('courses')
      .select('title')
      .eq('id', courseId)
      .single();

    const teacherName = teacher?.name || 'Your teacher';

    // Format scheduled time message
    let timeMessage = '';
    if (scheduledStart) {
      const startDate = new Date(scheduledStart);
      timeMessage = ` Starts at: ${startDate.toLocaleString()}.`;
    }

    // Get only students enrolled in this course
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('user_id')
      .eq('course_id', courseId);

    const studentIds = [...new Set((enrollments || []).map((e: any) => e.user_id))];

    if (studentIds.length > 0) {
      const notifications = studentIds.map((studentId: string) => ({
        user_id: studentId,
        title: 'New Exam Available!',
        message: `${teacherName} has created a new exam for ${course?.title || 'your course'}: "${quizTitle}". Code: ${accessCode}.${timeMessage}`,
        type: 'quiz',
        quiz_id: quizId,
        quiz_code: accessCode,
        is_read: false,
      }));

      await supabase.from('notifications').insert(notifications);
    }
  },

  // Teacher quiz management
  async createQuiz(teacherId: string, data: QuizData) {
    if (!data.courseId) {
      throw new Error('Course is required to create a quiz');
    }
    const bankIds = data.bankQuestionIds === undefined ? [] : data.bankQuestionIds;
    if (!Array.isArray(bankIds) || bankIds.some((id) => typeof id !== 'string' || !id.trim()) || new Set(bankIds).size !== bankIds.length) {
      throw submissionError('Selected bank question IDs must be unique and valid');
    }
    if (bankIds.length > MAX_QUESTIONS) throw submissionError(`Exam cannot have more than ${MAX_QUESTIONS} questions`);

    const { data: courseOwner } = await supabase
      .from('courses')
      .select('id, created_by')
      .eq('id', data.courseId)
      .single();

    if (!courseOwner || courseOwner.created_by !== teacherId) {
      throw Object.assign(new Error('You can only create exams for your assigned courses'), { statusCode: 403 });
    }

    let bankQuestions: QuizQuestion[] = [];
    if (bankIds.length) {
      const { data: rows, error: bankError } = await supabase.from('questions').select('*').in('id', bankIds);
      if (bankError) throw new Error(bankError.message);
      if (!rows || rows.length !== bankIds.length || rows.some((row: any) => !row.topic_id)) {
        throw Object.assign(new Error('Selected bank questions must belong to this course'), { statusCode: 403 });
      }
      const topicIds = [...new Set(rows.map((row: any) => row.topic_id))];
      const { data: topics, error: topicError } = await supabase.from('topics').select('id, course_id').in('id', topicIds);
      if (topicError) throw new Error(topicError.message);
      if (!topics || topics.length !== topicIds.length || topics.some((topic: any) => topic.course_id !== data.courseId)) {
        throw Object.assign(new Error('Selected bank questions must belong to this course'), { statusCode: 403 });
      }
      const byId = new Map(rows.map((row: any) => [row.id, row]));
      bankQuestions = bankIds.map((id) => snapshotBankQuestion(byId.get(id)));
    }
    const questions = [...(Array.isArray(data.questions) ? data.questions : []), ...bankQuestions];
    validateQuizPayload({ ...data, questions });

    // An institution's teachers share one five-quiz free allowance. The
    // database trigger (migration 018) is the authority and also protects
    // against concurrent create requests or callers outside this API.
    const { data: memberships, error: membershipError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', teacherId)
      .order('created_at', { ascending: true })
      .limit(1);
    if (membershipError) throw new Error(membershipError.message);

    if (memberships?.[0]?.organization_id) {
      const { data: organization, error: organizationError } = await supabase
        .from('organizations')
        .select('subscription_status, free_assessment_trials_used')
        .eq('id', memberships[0].organization_id)
        .single();

      if (organizationError && isMissingColumnError(organizationError, 'free_assessment_trials_used')) {
        const err: any = new Error('Institution trial setup is incomplete. Run migration 018_share_free_trials_by_institution.sql in Supabase, then try again.');
        err.statusCode = 400;
        throw err;
      }
      if (organizationError) throw new Error(organizationError.message);
      if (organization?.subscription_status !== 'active' && Number(organization?.free_assessment_trials_used || 0) >= 5) {
        const err: any = new Error('Your institution has used its five free assessment trials. Activate the Institution plan to create more quizzes.');
        err.statusCode = 403;
        throw err;
      }
    }

    // Generate unique 4-digit access code
    const accessCode = await this.generateUniqueCode();

    const baseInsert: any = {
      teacher_id: teacherId,
      title: data.title,
      description: data.description || '',
      course_id: data.courseId,
      time_limit: data.timeLimit,
      questions,
      access_code: accessCode,
      scheduled_start: data.scheduledStart || null,
      is_active: true,
      created_at: new Date(),
      violation_limit: data.violationLimit ?? 3,
    };

    // camera_monitoring column was added in migration 005.
    let insertResult = await supabase
      .from('teacher_quizzes')
      .insert([{ ...baseInsert, camera_monitoring: data.cameraMonitoring !== false }])
      .select()
      .single();

    if (insertResult.error && isMissingColumnError(insertResult.error, 'camera_monitoring')) {
      // If teacher explicitly opted OUT of camera, we must refuse — silently
      // falling back would persist the wrong setting and surprise the student.
      if (data.cameraMonitoring === false) {
        const err: any = new Error(
          'Database is missing the camera_monitoring column. Please run migration 005_add_camera_monitoring.sql in Supabase before disabling camera for a quiz.'
        );
        err.statusCode = 500;
        throw err;
      }
      console.warn('teacher_quizzes.camera_monitoring missing — run migration 005. Falling back to default (camera on).');
      insertResult = await supabase
        .from('teacher_quizzes')
        .insert([baseInsert])
        .select()
        .single();
    }

    // Course scoping and the violation limit are required to preserve the
    // student-access and integrity rules, so tell the owner exactly which
    // safe migration is needed instead of returning an opaque server error.
    if (insertResult.error && (isMissingColumnError(insertResult.error, 'course_id') || isMissingColumnError(insertResult.error, 'violation_limit'))) {
      const err: any = new Error('Exam setup is incomplete. Run migration 016_complete_teacher_quiz_schema.sql in Supabase, then try again.');
      err.statusCode = 400;
      throw err;
    }

    if (insertResult.error && String(insertResult.error.message || '').includes('FREE_ASSESSMENT_TRIAL_LIMIT_REACHED')) {
      const err: any = new Error('Your institution has used its five free assessment trials. Activate the Institution plan to create more quizzes.');
      err.statusCode = 403;
      throw err;
    }

    const { data: quiz, error } = insertResult;
    if (error) throw new Error(error.message);

    // Send notification only to enrolled students in selected course
    await this.notifyCourseStudents(data.title, quiz.id, accessCode, teacherId, data.courseId, data.scheduledStart);

    const { data: course } = await supabase
      .from('courses')
      .select('title')
      .eq('id', data.courseId)
      .single();

    return {
      _id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      courseId: quiz.course_id,
      courseTitle: course?.title || 'Unknown Course',
      timeLimit: quiz.time_limit,
      questions: quiz.questions,
      accessCode: quiz.access_code,
      scheduledStart: quiz.scheduled_start,
      cameraMonitoring: quiz.camera_monitoring !== false,
      violationLimit: quiz.violation_limit ?? 3,
      createdAt: quiz.created_at,
    };
  },

  async getTeacherQuizzes(teacherId: string) {
    const { data: quizzes, error } = await supabase
      .from('teacher_quizzes')
      .select('*')
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    const courseIds = [...new Set((quizzes || []).map((q: any) => q.course_id).filter(Boolean))];
    let courseMap = new Map<string, string>();

    if (courseIds.length > 0) {
      const { data: courses } = await supabase
        .from('courses')
        .select('id, title')
        .in('id', courseIds);

      courseMap = new Map((courses || []).map((c: any) => [c.id, c.title]));
    }
    
    return (quizzes || []).map((q: any) => ({
      _id: q.id,
      title: q.title,
      description: q.description,
      courseId: q.course_id,
      courseTitle: q.course_id ? (courseMap.get(q.course_id) || 'Unknown Course') : 'General',
      timeLimit: q.time_limit,
      questions: q.questions || [],
      accessCode: q.access_code,
      scheduledStart: q.scheduled_start,
      cameraMonitoring: q.camera_monitoring !== false,
      violationLimit: q.violation_limit ?? 3,
      createdAt: q.created_at,
    }));
  },

  async updateQuiz(quizId: string, teacherId: string, data: QuizData) {
    validateQuizPayload(data);
    const baseUpdate: any = {
      title: data.title,
      description: data.description || '',
      time_limit: data.timeLimit,
      // Preserve a newly selected date/time and allow a teacher to clear an
      // existing schedule by submitting null from the edit form.
      scheduled_start: data.scheduledStart || null,
      questions: data.questions,
      updated_at: new Date(),
    };
    const withCamera = typeof data.cameraMonitoring === 'boolean'
      ? { ...baseUpdate, camera_monitoring: data.cameraMonitoring }
      : baseUpdate;
    const withSecuritySettings = typeof data.violationLimit === 'number'
      ? { ...withCamera, violation_limit: data.violationLimit }
      : withCamera;

    let updateResult = await supabase
      .from('teacher_quizzes')
      .update(withSecuritySettings)
      .eq('id', quizId)
      .eq('teacher_id', teacherId)
      .select()
      .single();

    if (updateResult.error && isMissingColumnError(updateResult.error, 'camera_monitoring')) {
      console.warn('teacher_quizzes.camera_monitoring missing — run migration 005. Falling back without it.');
      const fallbackUpdate = typeof data.violationLimit === 'number'
        ? { ...baseUpdate, violation_limit: data.violationLimit }
        : baseUpdate;
      updateResult = await supabase
        .from('teacher_quizzes')
        .update(fallbackUpdate)
        .eq('id', quizId)
        .eq('teacher_id', teacherId)
        .select()
        .single();
    }

    const { data: quiz, error } = updateResult;
    if (error) throw new Error(error.message);
    return {
      _id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      timeLimit: quiz.time_limit,
      questions: quiz.questions,
      scheduledStart: quiz.scheduled_start,
      cameraMonitoring: quiz.camera_monitoring !== false,
      violationLimit: quiz.violation_limit ?? 3,
      createdAt: quiz.created_at,
    };
  },

  async deleteQuiz(quizId: string, teacherId: string) {
    const { error } = await supabase
      .from('teacher_quizzes')
      .delete()
      .eq('id', quizId)
      .eq('teacher_id', teacherId);

    if (error) throw new Error(error.message);
    return { success: true };
  },

  // Start a teacher quiz by access code
  async startQuizByCode(code: string, userId: string) {
    await assertStudentEmailPolicy(userId);

    // Get quiz by code
    const { data: quiz, error } = await supabase
      .from('teacher_quizzes')
      .select('*')
      .eq('access_code', code)
      .single();

    if (error || !quiz) {
      throw new Error('Invalid exam code');
    }

    // Ensure student is enrolled if this quiz is course-specific
    if (quiz.course_id) {
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id')
        .eq('user_id', userId)
        .eq('course_id', quiz.course_id)
        .maybeSingle();

      if (!enrollment) {
        throw new Error('You are not enrolled in this course. Please join the course first.');
      }
    }

    // Check if quiz has a scheduled start time. The teacher-defined `time_limit`
    // is the per-attempt duration, NOT the availability window. The availability
    // window is controlled separately by `is_active`. We only block early starts.
    if (quiz.scheduled_start) {
      const scheduledTime = new Date(quiz.scheduled_start);
      const now = new Date();
      if (now < scheduledTime) {
        throw new Error(`Exam will start at ${scheduledTime.toLocaleString()}. Please wait.`);
      }
    }

    if (quiz.is_active === false) {
      throw new Error('This exam is no longer accepting attempts.');
    }

    // One submitted attempt per student. This is enforced on the server so a
    // student cannot bypass the user interface by reusing the quiz code.
    const { data: completedAttempt, error: completedAttemptError } = await supabase
      .from('quiz_attempts')
      .select('id')
      .eq('user_id', userId)
      .eq('quiz_id', quiz.id)
      .eq('status', 'completed')
      .maybeSingle();

    if (completedAttemptError) throw new Error(completedAttemptError.message);
    if (completedAttempt) {
      throw Object.assign(
        new Error('You have already submitted this quiz. Each student has one attempt.'),
        { statusCode: 409 },
      );
    }

    // Reuse an existing in-progress attempt instead of spawning duplicates.
    // This also prevents a student from racing two concurrent attempts to
    // submit different answer sets.
    const { data: existing } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', userId)
      .eq('quiz_id', quiz.id)
      .eq('status', 'in-progress')
      .order('started_at', { ascending: false })
      .limit(1);

    let attempt = existing && existing.length > 0 ? existing[0] : null;

    // Never revive an attempt whose server-side deadline has passed. The
    // browser timer is only a convenience; the API remains authoritative.
    if (attempt && quiz.time_limit && attempt.started_at) {
      const deadline = new Date(attempt.started_at).getTime() + Number(quiz.time_limit) * 60_000;
      if (Date.now() >= deadline) {
        await supabase
          .from('quiz_attempts')
          .update({
            status: 'completed',
            completed_at: new Date(),
            auto_submitted: true,
            submission_reason: 'time_expired',
          })
          .eq('id', attempt.id)
          .eq('status', 'in-progress');
        attempt = null;
      }
    }

    if (!attempt) {
      const { data: created, error: attemptError } = await supabase
        .from('quiz_attempts')
        .insert([{
          user_id: userId,
          quiz_id: quiz.id,
          started_at: new Date(),
          status: 'in-progress',
          max_score: quiz.questions?.length || 0,
        }])
        .select()
        .single();

      if (attemptError) throw new Error(attemptError.message);
      attempt = created;
    }

    return {
      attemptId: attempt.id,
      quiz: {
        _id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        courseId: quiz.course_id,
        timeLimit: quiz.time_limit,
        cameraMonitoring: quiz.camera_monitoring !== false,
        violationLimit: quiz.violation_limit ?? 3,
        questions: questionOrderForAttempt(quiz.questions?.length || 0, attempt.id).map((questionIndex) => {
          const question = quiz.questions[questionIndex];
          const optionOrder = optionOrderForAttempt(question.options?.length || 0, attempt.id, questionIndex);
          return {
            _id: `${quiz.id}-q${questionIndex}`,
            text: question.text,
            options: optionOrder.map((optionIndex) => question.options[optionIndex]),
            difficulty: question.difficulty,
            questionType: question.questionType,
            timeLimit: question.timeLimit,
          };
        }),
      }
    };
  },

  // Get attempt results for student
  async getAttemptResults(attemptId: string, userId: string, userRole: string) {
    const { data: attempt, error } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .single();

    if (error || !attempt) {
      throw new Error('Attempt not found');
    }

    if (attempt.topic_id) {
      if (attempt.user_id !== userId && userRole !== 'admin') throw topicError('Unauthorized to view this attempt', 403);
      if (attempt.status !== 'completed') throw topicError('Exam attempt is not ready for results', 403);
      const snapshot = attempt.topic_question_snapshot as TopicSnapshotQuestion[] | null;
      if (!Array.isArray(snapshot) || !snapshot.length) throw topicError('Topic attempt is missing its question snapshot; contact support', 503);
      const { data: topicQuiz, error: topicQuizError } = await supabase.from('quizzes')
        .select('title, description').eq('id', attempt.quiz_id).maybeSingle();
      if (topicQuizError) throw new Error(topicQuizError.message);
      return {
        id: attempt.id, score: attempt.score, maxScore: snapshot.length, isTopicExam: true,
        percentage: Math.round((Number(attempt.score || 0) / snapshot.length) * 100),
        status: attempt.status, startedAt: attempt.started_at, completedAt: attempt.completed_at,
        answers: attempt.answers || [], reviewPending: false, reviewStatus: 'reviewed',
        quiz: {
          title: topicQuiz?.title || 'Topic exam', description: topicQuiz?.description || '',
          questions: snapshot.map(question => publicTopicQuestion(question, 0)),
        },
      };
    }

    // Get quiz details
    const { data: quiz } = await supabase
      .from('teacher_quizzes')
      .select('*')
      .eq('id', attempt.quiz_id)
      .single();

    const isStudentOwner = attempt.user_id === userId;
    const isTeacherOwner = !!quiz && quiz.teacher_id === userId;

    if (!isStudentOwner && !(userRole === 'teacher' && isTeacherOwner) && userRole !== 'admin') {
      throw new Error('Unauthorized to view this attempt');
    }

    // Teacher/admin review includes canonical answer keys. Those must remain
    // unavailable until the student has finished the attempt.
    if (!isStudentOwner && attempt.status !== 'completed') {
      throw Object.assign(new Error('Exam attempt is not ready for review'), { statusCode: 403 });
    }

    const isReviewed = attempt.teacher_grade !== null && attempt.teacher_grade !== undefined;
    const persistedViolations = !isStudentOwner
      ? (await persistedViolationsForAttempts([attempt.id])).get(attempt.id) || []
      : [];
    const { data: attemptStudent } = !isStudentOwner
      ? await supabase.from('users').select('name, email').eq('id', attempt.user_id).single()
      : { data: null };

    // Students never see violation details — only teachers/admins.
    const showViolations = !isStudentOwner;

    if (isStudentOwner && !isReviewed) {
      return {
        id: attempt.id,
        status: attempt.status,
        startedAt: attempt.started_at,
        completedAt: attempt.completed_at,
        reviewPending: true,
        reviewStatus: 'pending',
        autoSubmitted: attempt.auto_submitted,
        quiz: quiz ? {
          title: quiz.title,
          description: quiz.description,
          cameraMonitoring: quiz.camera_monitoring !== false,
          questions: [],
        } : null,
      };
    }

    return {
      id: attempt.id,
      score: attempt.score,
      maxScore: attempt.max_score,
      percentage: attempt.max_score > 0 ? Math.round((attempt.score / attempt.max_score) * 100) : 0,
      status: attempt.status,
      startedAt: attempt.started_at,
      completedAt: attempt.completed_at,
      answers: quiz ? answersForReview(attempt, quiz) : [],
      ...(showViolations
        ? {
            violations: persistedViolations,
            violationCount: persistedViolations.length,
            submissionReason: attempt.submission_reason,
            studentName: attemptStudent?.name || 'Unknown student',
            studentEmail: attemptStudent?.email || '',
          }
        : {}),
      teacherGrade: attempt.teacher_grade,
      teacherFeedback: attempt.teacher_feedback,
      reviewPending: false,
      reviewStatus: 'reviewed',
      autoSubmitted: attempt.auto_submitted,
      quiz: quiz ? {
        title: quiz.title,
        description: quiz.description,
        cameraMonitoring: quiz.camera_monitoring !== false,
        questions: quiz.questions || [],
      } : null,
    };
  },

  // Get all submissions for teacher
  async getTeacherSubmissions(teacherId: string) {
    // Get all quizzes by this teacher
    const { data: quizzes } = await supabase
      .from('teacher_quizzes')
      .select('id, title, questions')
      .eq('teacher_id', teacherId);

    if (!quizzes || quizzes.length === 0) return [];

    const quizIds = quizzes.map(q => q.id);
    const quizMap = new Map(quizzes.map(q => [q.id, q.title]));

    // Get all attempts for these quizzes
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('*')
      .in('quiz_id', quizIds)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false });

    if (!attempts) return [];

    // Get student info for each attempt
    const userIds = [...new Set(attempts.map(a => a.user_id))];
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', userIds);

    const userMap = new Map(users?.map(u => [u.id, u]) || []);

    const violationsByAttempt = await persistedViolationsForAttempts(attempts.map(attempt => attempt.id));
    return attempts.map(attempt => {
      const user = userMap.get(attempt.user_id) || { name: 'Unknown', email: '' };
      const normalizedViolations = violationsByAttempt.get(attempt.id) || [];
      return {
        id: attempt.id,
        quizId: attempt.quiz_id,
        quizTitle: quizMap.get(attempt.quiz_id) || 'Unknown Quiz',
        studentId: attempt.user_id,
        studentName: user.name || 'Unknown',
        studentEmail: user.email || '',
        score: attempt.score,
        maxScore: attempt.max_score,
        percentage: attempt.max_score > 0 ? Math.round((attempt.score / attempt.max_score) * 100) : 0,
        status: attempt.status,
        startedAt: attempt.started_at,
        completedAt: attempt.completed_at,
        teacherGrade: attempt.teacher_grade,
        teacherFeedback: attempt.teacher_feedback,
        answers: answersForReview(attempt, quizMap.get(attempt.quiz_id)),
        violations: normalizedViolations,
        violationCount: normalizedViolations.length,
        autoSubmitted: attempt.auto_submitted,
        submissionReason: attempt.submission_reason,
      };
    });
  },

  // Get quiz details for teacher
  async getTeacherQuizDetails(quizId: string, teacherId: string) {
    const { data: quiz, error } = await supabase
      .from('teacher_quizzes')
      .select('*')
      .eq('id', quizId)
      .eq('teacher_id', teacherId)
      .single();

    if (error || !quiz) {
      throw new Error('Exam not found');
    }

    return {
      id: quiz.id,
      title: quiz.title,
      questions: quiz.questions || [],
    };
  },

  // Grade a submission
  async gradeSubmission(submissionId: string, teacherId: string, grade: number, feedback: string) {
    // Verify the submission belongs to a quiz by this teacher
    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .select('quiz_id, user_id')
      .eq('id', submissionId)
      .single();

    if (!attempt) {
      throw new Error('Submission not found');
    }

    const { data: quiz } = await supabase
      .from('teacher_quizzes')
      .select('teacher_id, title')
      .eq('id', attempt.quiz_id)
      .single();

    if (!quiz || quiz.teacher_id !== teacherId) {
      throw new Error('Unauthorized');
    }

    // Update the attempt with grade and feedback
    const { error: updateError } = await supabase
      .from('quiz_attempts')
      .update({
        teacher_grade: grade,
        teacher_feedback: feedback,
      })
      .eq('id', submissionId);

    if (updateError) throw new Error(updateError.message);

    // Send notification to student
    await supabase.from('notifications').insert([{
      user_id: attempt.user_id,
      title: 'Exam Graded!',
      message: `Your exam "${quiz.title}" has been graded. Grade: ${grade}%`,
      type: 'grade',
      quiz_id: attempt.quiz_id,
      is_read: false,
    }]);

    return { success: true };
  },

  // Submit all quiz answers at once
  async submitAllAnswers(
    attemptId: string, 
    userId: string, 
    answers: SubmittedAttemptAnswer[],
    violations?: { type: string; timestamp: string; details?: string }[]
  ) {
    await assertStudentEmailPolicy(userId);

    // Get the attempt
    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('user_id', userId)
      .single();

    if (attemptError || !attempt) {
      throw new Error('Exam attempt not found');
    }

    const completingViolationAutoSubmit = attempt.status === 'completed' && attempt.submission_reason === 'excessive_violations';
    if (attempt.status === 'completed' && !completingViolationAutoSubmit) {
      throw new Error('Exam already submitted');
    }

    // Get quiz to calculate score
    const { data: quiz, error: quizError } = await supabase
      .from('teacher_quizzes')
      .select('id, title, teacher_id, questions, time_limit')
      .eq('id', attempt.quiz_id)
      .single();

    if (quizError || !quiz) {
      throw new Error('Exam not found');
    }

    const timeLimitMinutes = Number(quiz.time_limit || 0);
    const deadline = attempt.started_at && timeLimitMinutes > 0
      ? new Date(attempt.started_at).getTime() + timeLimitMinutes * 60_000
      : null;
    const timeExpired = deadline !== null && Date.now() >= deadline;

    const questions = quiz.questions || [];
    const normalizedSubmission = normalizeAttemptAnswers(quiz.id, attempt.id, questions, answers);
    const { score, answers: normalizedAnswers } = normalizedSubmission;

    // Update the attempt with violations
    const updateData: any = {
      status: 'completed',
      completed_at: new Date(),
      score,
      answers: normalizedAnswers,
    };

    if (timeExpired) {
      updateData.auto_submitted = true;
      updateData.submission_reason = 'time_expired';
    }
    
    // Violation events are written through report-violation and are the
    // authoritative source. Never replace server-recorded events with a
    // shorter, stale browser-memory list supplied during submission.

    // Atomic guard: only the first concurrent submit succeeds. The
    // `.eq('status', 'in-progress')` filter prevents a double-submit from
    // overwriting the original score with a second answer set.
    let updateQuery = supabase.from('quiz_attempts').update(updateData).eq('id', attemptId);
    updateQuery = completingViolationAutoSubmit
      ? updateQuery.eq('status', 'completed').eq('submission_reason', 'excessive_violations')
      : updateQuery.eq('status', 'in-progress');
    let updateResult = await updateQuery.select('id');

    // Auto-submit metadata is optional for old schemas, but monitoring event
    // persistence is not: report-violation returns an actionable migration
    // error instead of silently dropping an event.
    const missingOptionalSubmissionColumn = (error: any) => {
      const message = String(error?.message || '').toLowerCase();
      return ['violations', 'violation_count', 'auto_submitted', 'submission_reason']
        .some((column) => message.includes(column) && (message.includes('column') || message.includes('schema cache')));
    };
    if (updateResult.error && missingOptionalSubmissionColumn(updateResult.error)) {
      console.warn('Optional quiz-attempt monitoring columns are unavailable; saving submission without them.');
      updateResult = await supabase
        .from('quiz_attempts')
        .update({
          status: 'completed',
          completed_at: new Date(),
          score,
          answers: normalizedAnswers,
        })
        .eq('id', attemptId)
        .eq('status', completingViolationAutoSubmit ? 'completed' : 'in-progress')
        .select('id');
    }

    const { data: updatedRows, error: updateError } = updateResult;
    if (updateError) throw new Error(updateError.message);
    if (!updatedRows || updatedRows.length === 0) {
      throw new Error('Exam already submitted');
    }

    if (quiz.teacher_id) {
      const { error: notifyError } = await supabase.from('notifications').insert([{
        user_id: quiz.teacher_id,
        title: 'Submission Pending Review',
        message: 'A student submitted exam "' + quiz.title + '" and is waiting for your review.',
        type: 'submission',
        quiz_id: quiz.id,
        is_read: false,
      }]);

      if (notifyError) {
        console.error('Failed to notify teacher about submission:', notifyError.message);
      }
    }

    return {
      score,
      maxScore: questions.length,
      percentage: questions.length > 0 ? Math.round((score / questions.length) * 100) : 0,
      violationsCount: (await persistedViolationsForAttempts([attemptId])).get(attemptId)?.length || 0,
    };
  },

  async getQuizForTopic(topicId: string, userId: string, difficulty?: string) {
    await assertStudentEmailPolicy(userId);
    if (difficulty && !['Easy', 'Medium', 'Hard'].includes(difficulty)) {
      throw topicError('Difficulty must be Easy, Medium, or Hard', 400);
    }
    const targetDifficulty = difficulty || 'Medium';
    const { data: topic, error: topicLookupError } = await supabase.from('topics')
      .select('id, title, course_id').eq('id', topicId).maybeSingle();
    if (topicLookupError?.code === '22P02') throw topicError('Topic not found', 404);
    if (topicLookupError) throw new Error(topicLookupError.message);
    if (!topic) throw topicError('Topic not found', 404);

    const { data: course, error: courseError } = await supabase.from('courses')
      .select('id, is_published').eq('id', topic.course_id).maybeSingle();
    if (courseError) throw new Error(courseError.message);
    if (!course || course.is_published !== true) throw topicError('This topic is not published for exams', 403);

    const { data: enrollment, error: enrollmentError } = await supabase.from('enrollments')
      .select('id').eq('user_id', userId).eq('course_id', course.id).maybeSingle();
    if (enrollmentError) throw new Error(enrollmentError.message);
    if (!enrollment) throw topicError('You are not enrolled in this course', 403);

    const { data: published, error: publicationError } = await supabase.from('quizzes')
      .select('id, title, topic_id, time_limit').eq('topic_id', topicId).eq('is_published', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (publicationError) throw new Error(publicationError.message);
    if (!published) throw topicError('No published exam is available for this topic', 403);

    const { data: existing, error: existingError } = await supabase.from('quiz_attempts')
      .select('id, started_at, answers, topic_question_snapshot').eq('user_id', userId).eq('quiz_id', published.id)
      .eq('status', 'in-progress').order('started_at', { ascending: false }).limit(1);
    if (existingError) throw new Error(existingError.message);
    if (existing?.length) {
      const attempt = existing[0];
      const snapshot = attempt.topic_question_snapshot as TopicSnapshotQuestion[] | null;
      if (!Array.isArray(snapshot) || !snapshot.length) throw topicError('Topic attempt is missing its question snapshot; contact support', 503);
      const nextIndex = Array.isArray(attempt.answers) ? attempt.answers.length : 0;
      return { quizId: published.id, attemptId: attempt.id, question: snapshot[nextIndex] ? publicTopicQuestion(snapshot[nextIndex], topicRemainingSeconds(attempt, snapshot[nextIndex], published.time_limit)) : null, isComplete: nextIndex >= snapshot.length };
    }

    let questionQuery = supabase.from('questions').select('*').eq('topic_id', topicId);
    if (difficulty) questionQuery = questionQuery.eq('difficulty', difficulty);
    const { data: rows, error: questionError } = await questionQuery.limit(5);
    if (questionError) throw new Error(questionError.message);
    const snapshot: TopicSnapshotQuestion[] = [];
    for (const row of rows || []) {
      try { snapshot.push(topicSnapshotQuestion(row)); } catch { /* Skip unsupported bank question types. */ }
    }

    if (snapshot.length < 5) {
      try {
        const generated = await aiService.generateQuestions(topic.title, targetDifficulty, 5 - snapshot.length);
        for (const item of Array.isArray(generated) ? generated : []) {
          try {
            snapshot.push(topicSnapshotQuestion({ ...item, id: crypto.randomUUID(), question_type: 'multipleChoice', correct_answer: item.correct_answer_index, difficulty: targetDifficulty }));
          } catch { /* Invalid AI output must not enter an attempt. */ }
          if (snapshot.length === 5) break;
        }
      } catch (error) {
        console.warn('Topic exam AI generation unavailable:', error);
      }
    }
    if (!snapshot.length) throw topicError('No usable questions are available for this topic, and AI generation is unavailable', 422);

    const startedAt = new Date();
    const { data: created, error: attemptError } = await supabase.from('quiz_attempts').insert([{
      user_id: userId, quiz_id: published.id, topic_id: topicId, difficulty: targetDifficulty,
      started_at: startedAt, status: 'in-progress', score: 0, max_score: snapshot.length,
      total_questions: snapshot.length, answers: [], topic_question_snapshot: snapshot,
    }]).select('id').single();
    if (attemptError) {
      if (isMissingColumnError(attemptError, 'topic_question_snapshot')) {
        throw topicError('Topic exam setup is incomplete. Apply backend/migrations/022_topic_exam_attempt_snapshots.sql', 503);
      }
      if (attemptError.code === '23505') {
        const { data: raced } = await supabase.from('quiz_attempts').select('id, started_at, answers, topic_question_snapshot')
          .eq('user_id', userId).eq('quiz_id', published.id).eq('status', 'in-progress').limit(1);
        if (raced?.length && Array.isArray(raced[0].topic_question_snapshot)) {
          const current = raced[0];
          const index = Array.isArray(current.answers) ? current.answers.length : 0;
          return { quizId: published.id, attemptId: current.id, question: current.topic_question_snapshot[index] ? publicTopicQuestion(current.topic_question_snapshot[index], topicRemainingSeconds(current, current.topic_question_snapshot[index], published.time_limit)) : null, isComplete: false };
        }
      }
      throw new Error(attemptError.message);
    }
    return { quizId: published.id, attemptId: created.id, question: publicTopicQuestion(snapshot[0], topicRemainingSeconds({ started_at: startedAt.toISOString(), answers: [] }, snapshot[0], published.time_limit)), isComplete: false };
  },

  async getCurrentTopicQuestion(attemptId: string, userId: string) {
    const { data: attempt, error } = await supabase.from('quiz_attempts').select('id, user_id, quiz_id, topic_id, started_at, status, answers, topic_question_snapshot')
      .eq('id', attemptId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!attempt || !attempt.topic_id) throw topicError('Topic attempt not found', 404);
    if (attempt.user_id !== userId) throw topicError('Not authorized to access this attempt', 403);
    if (attempt.status === 'completed') return { isComplete: true, question: null };
    if (attempt.status !== 'in-progress') throw topicError('Exam attempt is no longer active', 409);
    const snapshot = attempt.topic_question_snapshot as TopicSnapshotQuestion[] | null;
    if (!Array.isArray(snapshot) || !snapshot.length) throw topicError('Topic attempt is missing its question snapshot; contact support', 503);
    const index = Array.isArray(attempt.answers) ? attempt.answers.length : 0;
    const { data: quiz, error: quizError } = await supabase.from('quizzes').select('time_limit').eq('id', attempt.quiz_id).maybeSingle();
    if (quizError) throw new Error(quizError.message);
    return { isComplete: index >= snapshot.length, question: snapshot[index] ? publicTopicQuestion(snapshot[index], topicRemainingSeconds(attempt, snapshot[index], quiz?.time_limit)) : null };
  },

  async submitAnswer(attemptId: string, questionId: string, answer: number, userId: string) {
    const { data: attempt, error: lookupError } = await supabase.from('quiz_attempts')
      .select('id, user_id, quiz_id, topic_id, started_at, status, answers, score, topic_question_snapshot')
      .eq('id', attemptId).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!attempt || !attempt.topic_id) throw topicError('Topic attempt not found', 404);
    if (attempt.user_id !== userId) throw topicError('Not authorized to submit to this attempt', 403);
    if (attempt.status !== 'in-progress') throw topicError('Exam attempt is no longer active', 409);
    const snapshot = attempt.topic_question_snapshot as TopicSnapshotQuestion[] | null;
    const savedAnswers = attempt.answers;
    if (!Array.isArray(snapshot) || !Array.isArray(savedAnswers)) throw topicError('Topic attempt is missing its question snapshot; contact support', 503);
    const question = snapshot[savedAnswers.length];
    if (!question || question.id !== questionId) throw topicError('Answer does not match the current question', 400);
    if (!Number.isInteger(answer) || answer < -1 || answer >= question.options.length) throw topicError('Selected option is out of range', 400);
    const { data: quiz, error: quizError } = await supabase.from('quizzes').select('time_limit').eq('id', attempt.quiz_id).maybeSingle();
    if (quizError) throw new Error(quizError.message);
    if (topicRemainingSeconds(attempt, question, quiz?.time_limit) === 0 && answer !== -1) {
      throw topicError('Question time has expired; submit it unanswered', 409);
    }
    const isCorrect = answer === question.correctAnswer;
    const nextAnswers = [...savedAnswers, { questionId, selectedAnswer: answer === -1 ? null : answer, isCorrect, answeredAt: new Date().toISOString() }];
    const isComplete = nextAnswers.length === snapshot.length;
    const update = supabase.from('quiz_attempts').update({
      answers: nextAnswers, score: Number(attempt.score || 0) + (isCorrect ? 1 : 0),
      ...(isComplete ? { status: 'completed', completed_at: new Date() } : {}),
    }).eq('id', attemptId).eq('user_id', userId).eq('status', 'in-progress')
      .eq('answers', JSON.stringify(savedAnswers));
    const { data: updated, error: updateError } = await update.select('id');
    if (updateError) throw new Error(updateError.message);
    if (!updated?.length) throw topicError('This answer was already submitted or the attempt changed. Refresh and try again', 409);
    return { isCorrect, isComplete };
  },

  // Get teacher analytics
  async getTeacherAnalytics(teacherId: string) {
    // Get all quizzes by this teacher
    const { data: quizzes } = await supabase
      .from('teacher_quizzes')
      .select('id, title')
      .eq('teacher_id', teacherId);

    if (!quizzes || quizzes.length === 0) {
      return {
        totalStudents: 0,
        totalQuizzes: 0,
        totalAttempts: 0,
        avgScore: 0,
        passRate: 0,
        recentAttempts: [],
        scoreDistribution: [],
        weeklyData: [],
        courseParticipation: [],
      };
    }

    const quizIds = quizzes.map(q => q.id);

    // Get all attempts for these quizzes
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('*')
      .in('quiz_id', quizIds)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false });

    const completedAttempts = attempts || [];

    // Calculate stats
    const uniqueStudents = new Set(completedAttempts.map(a => a.user_id));
    const scores = completedAttempts.map(a => a.max_score > 0 ? (a.score / a.max_score) * 100 : 0);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const passCount = scores.filter(s => s >= 60).length;
    const passRate = scores.length > 0 ? (passCount / scores.length) * 100 : 0;

    // Score distribution
    const scoreDistribution = [
      { range: '0-50', count: scores.filter(s => s < 50).length, color: '#EF4444' },
      { range: '50-70', count: scores.filter(s => s >= 50 && s < 70).length, color: '#F59E0B' },
      { range: '70-85', count: scores.filter(s => s >= 70 && s < 85).length, color: '#10B981' },
      { range: '85-100', count: scores.filter(s => s >= 85).length, color: '#4ca1af' },
    ];

    // Weekly data for chart (last 4 weeks)
    const now = new Date();
    const weeklyData = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - (i * 7) - 7);
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - (i * 7));
      
      const weekAttempts = completedAttempts.filter(a => {
        const date = new Date(a.completed_at);
        return date >= weekStart && date < weekEnd;
      });

      weeklyData.push({
        date: `Week ${4 - i}`,
        attempts: weekAttempts.length,
        avgScore: weekAttempts.length > 0 
          ? Math.round(weekAttempts.reduce((sum, a) => sum + (a.max_score > 0 ? (a.score / a.max_score) * 100 : 0), 0) / weekAttempts.length)
          : 0,
      });
    }

    // Course-wise participation data (enrolled count, participating count, percentage)
    const { data: teacherCourses } = await supabase
      .from('courses')
      .select('id, title, created_by')
      .eq('created_by', teacherId);

    const courseParticipation: Array<{
      courseId: string;
      courseName: string;
      enrolledStudents: number;
      attemptedStudents: number;
      participationPercentage: number;
    }> = [];

    for (const course of teacherCourses || []) {
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('user_id')
        .eq('course_id', course.id);

      const enrolledIds = [...new Set((enrollments || []).map((e: any) => e.user_id))];

      const { data: courseQuizzes } = await supabase
        .from('teacher_quizzes')
        .select('id')
        .eq('teacher_id', teacherId)
        .eq('course_id', course.id);

      const courseQuizIds = (courseQuizzes || []).map((q: any) => q.id);

      let attemptedStudents = 0;
      if (courseQuizIds.length > 0) {
        const { data: courseAttempts } = await supabase
          .from('quiz_attempts')
          .select('user_id')
          .in('quiz_id', courseQuizIds)
          .eq('status', 'completed');

        attemptedStudents = new Set((courseAttempts || []).map((a: any) => a.user_id)).size;
      }

      const enrolledStudents = enrolledIds.length;
      const participationPercentage = enrolledStudents > 0
        ? Math.round((attemptedStudents / enrolledStudents) * 100)
        : 0;

      courseParticipation.push({
        courseId: course.id,
        courseName: course.title,
        enrolledStudents,
        attemptedStudents,
        participationPercentage,
      });
    }

    return {
      totalStudents: uniqueStudents.size,
      totalQuizzes: quizzes.length,
      totalAttempts: completedAttempts.length,
      avgScore: Math.round(avgScore * 10) / 10,
      passRate: Math.round(passRate * 10) / 10,
      scoreDistribution,
      weeklyData,
      courseParticipation,
    };
  },

  // Get student analytics
  async getStudentAnalytics(userId: string) {
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: true });

    if (!attempts || attempts.length === 0) {
      return {
        totalQuizzes: 0,
        avgScore: 0,
        passRate: 0,
        streakDays: 0,
        performanceData: [],
      };
    }

    const scores = attempts.map(a => a.max_score > 0 ? (a.score / a.max_score) * 100 : 0);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const passCount = scores.filter(s => s >= 60).length;
    const passRate = (passCount / scores.length) * 100;

    // Performance data for chart (last 6 attempts or weeks)
    const performanceData = attempts.slice(-6).map((a, index) => ({
      week: `Exam ${index + 1}`,
      score: a.max_score > 0 ? Math.round((a.score / a.max_score) * 100) : 0,
    }));

    // Calculate streak (simplified - days with at least one quiz)
    let streakDays = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const hasAttempt = attempts.some(a => {
        const attemptDate = new Date(a.completed_at);
        attemptDate.setHours(0, 0, 0, 0);
        return attemptDate.getTime() === checkDate.getTime();
      });
      if (hasAttempt || i === 0) {
        if (hasAttempt) streakDays++;
      } else {
        break;
      }
    }

    return {
      totalQuizzes: attempts.length,
      avgScore: Math.round(avgScore * 10) / 10,
      passRate: Math.round(passRate * 10) / 10,
      streakDays,
      performanceData,
    };
  },

  async getHint(questionId: string) {
      const { data: question } = await supabase
      .from('questions')
      .select('hint')
      .eq('id', questionId)
      .single();
      
      return question?.hint || "No hint available.";
  },

  async getQuizHistory(userId: string) {
    try {
      // Get user's quiz attempts
      const { data: attempts, error } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('user_id', userId)
        .order('completed_at', { ascending: false });

      if (error) throw new Error(error.message);
      if (!attempts || attempts.length === 0) return [];

      // Get quiz titles
      const teacherIds = [...new Set(attempts.filter(a => !a.topic_id).map(a => a.quiz_id).filter(Boolean))];
      const topicIds = [...new Set(attempts.filter(a => a.topic_id).map(a => a.quiz_id).filter(Boolean))];
      const { data: teacherQuizzes, error: teacherError } = teacherIds.length
        ? await supabase.from('teacher_quizzes').select('id, title').in('id', teacherIds)
        : { data: [], error: null };
      if (teacherError) throw new Error(teacherError.message);
      const { data: topicQuizzes, error: topicError } = topicIds.length
        ? await supabase.from('quizzes').select('id, title').in('id', topicIds)
        : { data: [], error: null };
      if (topicError) throw new Error(topicError.message);
      const quizMap = new Map([...(teacherQuizzes || []), ...(topicQuizzes || [])].map(q => [q.id, q.title]));

      return attempts.map(attempt => {
        const reviewed = (!!attempt.topic_id && attempt.status === 'completed')
          || (!attempt.topic_id && attempt.teacher_grade !== null && attempt.teacher_grade !== undefined);
        return {
        _id: attempt.id,
        quizId: attempt.quiz_id,
        quizTitle: quizMap.get(attempt.quiz_id) || 'Quiz',
        score: reviewed && attempt.max_score > 0 ? Math.round((attempt.score / attempt.max_score) * 100) : null,
        totalQuestions: attempt.max_score,
        correctAnswers: reviewed ? attempt.score : null,
        timeTaken: 0,
        isCompleted: attempt.status === 'completed',
        attemptedAt: attempt.completed_at || attempt.started_at,
        teacherGrade: reviewed ? attempt.teacher_grade : undefined,
        teacherFeedback: reviewed ? attempt.teacher_feedback : undefined,
        reviewStatus: reviewed ? 'reviewed' : 'pending',
      };
      });
    } catch (err) {
      console.error('Error fetching quiz history:', err);
      return [];
    }
  },

};
