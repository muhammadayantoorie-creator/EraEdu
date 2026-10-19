process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
import { canReleaseStudentResult } from '../services/resultReleasePolicy';
import { quizService } from '../services/quizService';
import { analyticsService } from '../services/analyticsService';

const reviewed = { id: 'a', user_id: 'student-1', quiz_id: 'exam', status: 'completed', teacher_grade: 33, score: 1, max_score: 3, completed_at: '2030-01-01' };
const pending = { ...reviewed, id: 'b', teacher_grade: null, score: 3 };
function setup(rows: any[], failure: any = null) {
  const eq = jest.fn();
  mockFrom.mockImplementation(table => {
    if (table === 'enrollments') return { select: () => ({ eq: async () => ({ count: 0, error: failure }) }) };
    const response = { data: table === 'teacher_quizzes' ? [{ id: 'exam', title: 'Exam' }] : rows, error: failure };
    const query: any = { select: () => query, eq: (...args: any[]) => { eq(...args); return query; },
      order: () => query, range: async () => response, in: async () => response,
      single: async () => ({ data: rows[0], error: failure }),
      then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject) };
    return query;
  });
  return eq;
}
beforeEach(() => mockFrom.mockReset());

test('one shared policy denies premature/invalid grades and preserves reviewed zero and topic completion', () => {
  expect(canReleaseStudentResult({ ...reviewed, status: 'in-progress' })).toBe(false);
  expect(canReleaseStudentResult(pending)).toBe(false);
  expect(canReleaseStudentResult({ ...reviewed, teacher_grade: NaN })).toBe(false);
  expect(canReleaseStudentResult({ ...reviewed, teacher_grade: 0 })).toBe(true);
  expect(canReleaseStudentResult({ ...pending, topic_id: 'topic' })).toBe(true);
});
test('student chart and dashboard exclude unreleased perfect scores, retain authoritative 1/3', async () => {
  const eq = setup([reviewed, pending]);
  await expect(quizService.getStudentAnalytics('student-1')).resolves.toMatchObject({
    totalQuizzes: 2, pendingReviews: 1, avgScore: 33.3, passRate: 0, performanceData: [{ week: 'Exam 1', score: 33 }],
  });
  await expect(analyticsService.getDashboardStats('student-1')).resolves.toMatchObject({ averageScore: 33, pendingReviews: 1 });
  expect(eq).toHaveBeenCalledWith('user_id', 'student-1');
});
test.each([{ rows: [] }, { rows: [pending] }])('no released score is unavailable, never a fabricated zero (%j)', async ({ rows }) => {
  setup(rows);
  await expect(quizService.getStudentAnalytics('student-1')).resolves.toMatchObject({ avgScore: null, passRate: null, performanceData: [] });
  await expect(analyticsService.getDashboardStats('student-1')).resolves.toMatchObject({ averageScore: null });
});
test('a reviewed zero remains a genuine zero', async () => {
  setup([{ ...reviewed, score: 0, teacher_grade: 0 }]);
  await expect(quizService.getStudentAnalytics('student-1')).resolves.toMatchObject({ avgScore: 0 });
  await expect(analyticsService.getDashboardStats('student-1')).resolves.toMatchObject({ averageScore: 0 });
});
test('legacy active graded history stays pending; completed reviewed history stays 33%', async () => {
  setup([{ ...reviewed, status: 'in-progress' }, reviewed]);
  const history = await quizService.getQuizHistory('student-1');
  expect(history[0]).toMatchObject({ score: null, correctAnswers: null, reviewStatus: 'pending' });
  expect(history[1]).toMatchObject({ score: 33, correctAnswers: 1, reviewStatus: 'reviewed' });
});
test('failed analytics reads reject instead of returning believable zero totals', async () => {
  setup([], { message: 'storage unavailable' });
  await expect(quizService.getStudentAnalytics('student-1')).rejects.toThrow('storage unavailable');
  await expect(analyticsService.getDashboardStats('student-1')).rejects.toThrow('Unable to load');
});
test('a repeated pending submission reveals neither score, maxScore, percentage nor hidden violation count', async () => {
  setup([{ ...pending, teacher_quiz_snapshot: { questions: [{ text: 'Q', options: ['a','b'], correctAnswer: 0 }] } }]);
  const result = await quizService.submitAllAnswers('b', 'student-1', []);
  expect(result.reviewPending).toBe(true);
  for (const field of ['score', 'maxScore', 'percentage', 'violationsCount']) expect(result).not.toHaveProperty(field);
});
