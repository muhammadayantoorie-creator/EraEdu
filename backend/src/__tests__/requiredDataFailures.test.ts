process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-key';
process.env.JWT_SECRET = 'isolated-required-data-test-secret-long-enough';
const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
import { analyticsService } from '../services/analyticsService';
import { quizService } from '../services/quizService';

function setup(failedTable?: string, empty = false) {
  const filters: Array<[string, string, unknown]> = [];
  const rows: Record<string, any[]> = {
    teacher_quizzes: [{ id: 'exam', title: 'Exam', questions: [] }],
    courses: [{ id: 'course', title: 'Course' }], topics: [{ id: 'topic', course_id: 'course' }],
    quiz_attempts: [{ id: 'attempt', user_id: 'student', quiz_id: 'exam', status: 'completed', answers: [], score: 0, max_score: 1 }],
    users: [{ id: 'student', name: 'Student' }], enrollments: [], questions: [], cheating_violations: [],
  };
  mockFrom.mockImplementation(table => {
    const result = { data: failedTable === table ? null : empty ? [] : rows[table], error: failedTable === table ? { message: 'private DB failure' } : null };
    const query: any = { select: () => query, eq: (key: string, value: unknown) => { filters.push([table, key, value]); return query; },
      in: () => query, order: () => query, gte: () => query,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
    return query;
  });
  return filters;
}
beforeEach(() => { mockFrom.mockReset(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());
it.each(['teacher_quizzes', 'quiz_attempts', 'users'])('submission %s failures are retryable, never an empty success', async table => {
  setup(table);
  await expect(quizService.getTeacherSubmissions('teacher')).rejects.toMatchObject({ statusCode: 503, message: 'Student submissions could not be loaded. Please retry.' });
});
it('genuine empty submissions return an empty list, with teacher scoping', async () => {
  const filters = setup(undefined, true);
  await expect(quizService.getTeacherSubmissions('teacher')).resolves.toEqual([]);
  expect(filters).toContainEqual(['teacher_quizzes', 'teacher_id', 'teacher']);
});
it.each(['teacher_quizzes', 'courses', 'quiz_attempts', 'enrollments'])('time series propagates %s failures', async table => {
  setup(table);
  await expect(analyticsService.getTeacherTimeSeries('teacher', '30d')).rejects.toMatchObject({ statusCode: 503 });
});
it.each([
  ['getTeacherCourses', 'courses'], ['getTeacherCourses', 'enrollments'],
  ['getTeacherTopics', 'courses'], ['getTeacherTopics', 'topics'], ['getTeacherTopics', 'questions'],
  ['getTeacherQuestions', 'questions'],
] as const)('%s propagates required %s errors', async (method, table) => {
  setup(table);
  await expect(analyticsService[method]('teacher')).rejects.toMatchObject({ statusCode: 503 });
});
it('genuine empty teacher resources remain successful', async () => {
  setup(undefined, true);
  for (const method of ['getTeacherCourses', 'getTeacherTopics', 'getTeacherQuestions'] as const) {
    await expect(analyticsService[method]('teacher')).resolves.toEqual([]);
  }
});
