process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-quiz-update-secret-minimum-32-characters';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-key';
const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
import { quizService } from '../services/quizService';

const payload = {
  title: 'Updated exam', description: 'Updated description', courseId: 'course-new',
  scheduledStart: '2026-10-25T16:14:00.000Z', timeLimit: 3,
  cameraMonitoring: false, violationLimit: 5,
  questions: [{ text: 'Updated question', options: ['Yes', 'No'], correctAnswer: 1, difficulty: 'Easy', timeLimit: 180 }],
};

function setup({ courseOwner = 'teacher', courseError = null as any, writeError = null as any, examOwner = 'teacher' } = {}) {
  const stored: any = { id: 'exam', teacher_id: examOwner, title: 'Old exam', course_id: 'course-old',
    questions: [], access_code: '1234', created_at: '2026-10-20T00:00:00Z' };
  let values: any;
  const filters: Record<string, string> = {};
  const finish = async () => {
    if (writeError) return { data: null, error: writeError };
    if (filters.id !== stored.id || filters.teacher_id !== stored.teacher_id) return { data: null, error: null };
    Object.assign(stored, values);
    return { data: { ...stored }, error: null };
  };
  const write = jest.fn(input => { values = input; return query; });
  const query: any = { update: write, eq: (key: string, value: string) => { filters[key] = value; return query; },
    select: () => query, single: finish, maybeSingle: finish };
  mockFrom.mockImplementation(table => {
    if (table === 'teacher_quizzes') return query;
    if (table === 'courses') return { select: () => ({ eq: (_key: string, id: string) => ({
      single: async () => ({ data: courseError ? null : { id, created_by: courseOwner, title: 'Selected course' }, error: courseError }),
    }) }) };
    throw new Error(`Unexpected table ${table}`);
  });
  return { stored, write, filters };
}
beforeEach(() => mockFrom.mockReset());

test('persists the newly selected course and returns the saved exam with its original access code', async () => {
  const { stored, write, filters } = setup();
  const result = await quizService.updateQuiz('exam', 'teacher', payload);
  expect(stored).toMatchObject({ title: payload.title, course_id: payload.courseId, scheduled_start: payload.scheduledStart,
    camera_monitoring: false, violation_limit: 5, questions: payload.questions });
  expect(result).toMatchObject({ _id: 'exam', courseId: 'course-new', accessCode: '1234', scheduledStart: payload.scheduledStart });
  expect(write).toHaveBeenCalledTimes(1);
  expect(filters).toEqual({ id: 'exam', teacher_id: 'teacher' });
  expect(mockFrom.mock.calls.map(([table]) => table)).not.toContain('quiz_attempts');
});

test('an older client omitting courseId preserves the existing course and can clear the schedule', async () => {
  const { stored, write } = setup();
  await quizService.updateQuiz('exam', 'teacher', { ...payload, courseId: undefined, scheduledStart: undefined });
  expect(stored.course_id).toBe('course-old');
  expect(stored.scheduled_start).toBeNull();
  expect(write.mock.calls[0][0]).not.toHaveProperty('course_id');
});

test('rejects moving an exam into another teacher\'s course before writing', async () => {
  const { stored, write } = setup({ courseOwner: 'other-teacher' });
  await expect(quizService.updateQuiz('exam', 'teacher', payload)).rejects.toMatchObject({ statusCode: 403 });
  expect(stored.course_id).toBe('course-old');
  expect(write).not.toHaveBeenCalled();
});

test.each(['', null])('rejects an explicit empty course (%s) rather than detaching the exam', async courseId => {
  const { write } = setup();
  await expect(quizService.updateQuiz('exam', 'teacher', { ...payload, courseId } as any)).rejects.toMatchObject({ statusCode: 400 });
  expect(write).not.toHaveBeenCalled();
});

test('a failed course lookup cannot write or report success', async () => {
  const { write } = setup({ courseError: { message: 'lookup unavailable' } });
  await expect(quizService.updateQuiz('exam', 'teacher', payload)).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
});

test('another teacher cannot edit the exam even when the destination course belongs to them', async () => {
  const { stored } = setup({ examOwner: 'other-teacher' });
  await expect(quizService.updateQuiz('exam', 'teacher', payload)).rejects.toMatchObject({ statusCode: 404 });
  expect(stored.title).toBe('Old exam');
  expect(stored.course_id).toBe('course-old');
});

test('a database course reassignment guard is reported as a permission failure', async () => {
  setup({ writeError: { code: 'P0001', message: 'Only the assigned course teacher can manage this exam' } });
  await expect(quizService.updateQuiz('exam', 'teacher', payload)).rejects.toMatchObject({ statusCode: 403 });
});

test('short-answer question types and saved expected answers survive an edit', async () => {
  const { stored } = setup();
  const questions = [{ text: 'Explain this', options: [], correctAnswer: -1, questionType: 'shortAnswer' as const,
    answerText: 'Expected answer', difficulty: 'Medium', timeLimit: 60 }];
  await quizService.updateQuiz('exam', 'teacher', { ...payload, questions });
  expect(stored.questions).toEqual(questions);
});
