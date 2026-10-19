process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-submission-read-test-secret-long-enough';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-key';
const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
import { quizService } from '../services/quizService';
import { getTeacherSubmissions } from '../controllers/quizController';
import { errorHandler } from '../middleware/errorHandler';
import { cheatingViolationService } from '../services/cheatingViolationService';
import express from 'express';
import request from 'supertest';

const snapshotQuestions = [{ text: 'Original question', options: ['A', 'B'], correctAnswer: 0, difficulty: 'Easy' }];
function setup({ legacyMonitoring = false, nullUser = false, failure = '' } = {}) {
  const rows: Record<string, any[]> = {
    teacher_quizzes: [
      { id: 'exam', teacher_id: 'teacher', title: 'Edited title', questions: [{ ...snapshotQuestions[0], text: 'Edited question' }] },
      { id: 'foreign-exam', teacher_id: 'foreign-teacher', title: 'Foreign exam', questions: [] },
    ],
    quiz_attempts: [
      { id: 'attempt', quiz_id: 'exam', user_id: nullUser ? null : 'student', status: 'completed',
        score: 1, max_score: 1, teacher_grade: null,
        teacher_quiz_snapshot: { id: 'exam', title: 'Original title', questions: snapshotQuestions },
        answers: [{ questionId: 'exam-q0', selectedAnswer: 0, isCorrect: true, answerVersion: 2 }] },
      { id: 'foreign-attempt', quiz_id: 'foreign-exam', user_id: 'foreign-student', status: 'completed' },
      { id: 'active-attempt', quiz_id: 'exam', user_id: 'student', status: 'in-progress' },
    ],
    users: [{ id: 'student', name: 'Student', email: 'isolated@example.test' }],
    cheating_violations: [
      { id: 'event', quiz_attempt_id: 'attempt', violation_type: 'tab_change', timestamp: '2030-01-01', details: { alertMessage: 'Tab changed' }, severity: 'medium', detection_method: 'browser_event', ...(legacyMonitoring ? {} : { event_id: 'stable-event' }) },
      { id: 'foreign-event', quiz_attempt_id: 'foreign-attempt', violation_type: 'no_face', timestamp: '2030-01-01' },
    ],
  };
  const reads: Array<{ table: string; column: string; values: any }> = [];
  mockFrom.mockImplementation(table => {
    let columns = '*'; let data = rows[table]; let invalidId = false;
    const query: any = {
      select: (selection = '*') => { columns = selection; return query; },
      eq: (column: string, value: any) => { reads.push({ table, column, values: value }); data = data.filter(row => row[column] === value); return query; },
      in: (column: string, values: any[]) => { reads.push({ table, column, values }); invalidId = table === 'users' && values.some(value => value == null); data = data.filter(row => values.includes(row[column])); return query; },
      order: () => query,
      then: (resolve: any, reject: any) => {
        const error = failure === table ? { code: '08006', message: 'private database connection details' }
          : invalidId ? { code: '22P02', message: 'invalid input syntax for type uuid: "null"' }
          : legacyMonitoring && table === 'cheating_violations' && columns.split(',').map(value => value.trim()).includes('event_id')
            ? { code: '42703', message: 'column cheating_violations.event_id does not exist' } : null;
        return Promise.resolve({ data: error ? null : data, error }).then(resolve, reject);
      },
    };
    return query;
  });
  return reads;
}
beforeEach(() => { mockFrom.mockReset(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

it('loads actual legacy monitoring rows when the write-retry event_id column is absent', async () => {
  setup({ legacyMonitoring: true });
  await expect(quizService.getTeacherSubmissions('teacher')).resolves.toMatchObject([
    { id: 'attempt', studentName: 'Student', teacherGrade: null, quizTitle: 'Original title', violationCount: 1,
      violations: [{ type: 'tab_change', severity: 'medium' }], answers: [{ selectedAnswer: 0, isCorrect: true }] },
  ]);
});

it('does not send a nullable legacy student reference as a literal null UUID filter', async () => {
  const reads = setup({ nullUser: true });
  await expect(quizService.getTeacherSubmissions('teacher')).resolves.toMatchObject([{ id: 'attempt', studentName: 'Unknown', studentEmail: '', violationCount: 1 }]);
  expect(reads.filter(read => read.table === 'users')).toEqual([]);
});

it('keeps live event identities and excludes other teachers and active attempts', async () => {
  const reads = setup();
  const submissions = await quizService.getTeacherSubmissions('teacher');
  expect(submissions).toHaveLength(1);
  expect(submissions[0].violations[0]).toMatchObject({ eventId: 'stable-event' });
  expect(reads).toContainEqual({ table: 'teacher_quizzes', column: 'teacher_id', values: 'teacher' });
  expect(reads).toContainEqual({ table: 'quiz_attempts', column: 'status', values: 'completed' });
  expect(reads).toContainEqual({ table: 'cheating_violations', column: 'quiz_attempt_id', values: ['attempt'] });
});

it.each(['teacher_quizzes', 'quiz_attempts', 'users', 'cheating_violations'])('a real %s outage remains an error with no fabricated zero events', async failure => {
  setup({ failure });
  await expect(quizService.getTeacherSubmissions('teacher')).rejects.toMatchObject({ statusCode: 503 });
});

it('HTTP failures return a safe retryable message without private database diagnostics', async () => {
  setup({ failure: 'cheating_violations' });
  const app = express();
  app.get('/submissions', (req: any, _res, next) => { req.user = { _id: 'teacher' }; next(); }, getTeacherSubmissions);
  app.use(errorHandler);
  const response = await request(app).get('/submissions');
  expect(response.status).toBe(503);
  expect(response.body.error.message).toContain('monitoring records');
  expect(JSON.stringify(response.body)).not.toContain('private database');
});

it('legacy read compatibility does not drop the stable event-ID requirement for new writes', async () => {
  mockFrom.mockImplementation(table => {
    if (table === 'quiz_attempts') return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: { id: 'attempt', user_id: 'student', quiz_id: 'exam', topic_id: 'topic', status: 'in-progress' }, error: null }) }) }) }) };
    if (table === 'teacher_quizzes') return { select: () => ({ eq: () => ({ single: async () => ({ data: { teacher_id: 'teacher', violation_limit: 3 }, error: null }) }) }) };
    if (table === 'cheating_violations') return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '42703', message: 'column event_id does not exist' } }) }) }) };
    throw new Error(`Unexpected ${table}`);
  });
  await expect(cheatingViolationService.reportViolation({ quizAttemptId: 'attempt', studentId: 'student', quizId: 'exam',
    violationType: 'tab_change', detectionMethod: 'browser_event', eventId: 'stable-event' }))
    .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('019_make_cheating_events_authoritative.sql') });
});

it('the teacher HTTP list succeeds when reading legacy monitoring rows', async () => {
  setup({ legacyMonitoring: true });
  const app = express();
  app.get('/submissions', (req: any, _res, next) => { req.user = { _id: 'teacher' }; next(); }, getTeacherSubmissions);
  app.use(errorHandler);
  const response = await request(app).get('/submissions');
  expect(response.status).toBe(200);
  expect(response.body.data).toHaveLength(1);
  expect(response.body.data[0]).toMatchObject({ id: 'attempt', violationCount: 1 });
});
