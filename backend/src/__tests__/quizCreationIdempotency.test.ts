process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-quiz-create-secret-at-least-32-characters';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-key';
const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
import { quizService } from '../services/quizService';
import { createQuiz } from '../controllers/quizController';
import { errorHandler } from '../middleware/errorHandler';
import express from 'express';
import request from 'supertest';

const key = '80d3473f-f062-4320-811f-daf5b5e45f8e';
const otherKey = 'a87697e0-61b1-4686-96c7-dd9e96cb5cab';
const payload = { title: 'NLP', courseId: 'course', timeLimit: 1,
  questions: [{ text: 'Explain', questionType: 'shortAnswer' as const, options: [], correctAnswer: -1, difficulty: 'Easy', timeLimit: 60 }] };
type Mode = 'normal' | 'duplicate-race' | 'quota-race' | 'lost-response' | 'quota-precheck';
function setup(mode: Mode = 'normal') {
  const rows = new Map<string, any>();
  const inserts: any[] = [];
  const lookups: any[] = [];
  let lookupCount = 0;
  let quotaReads = 0;
  mockFrom.mockImplementation(table => {
    if (table === 'courses') return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'course', created_by: 'teacher', title: 'Programming' }, error: null }) }) }) };
    if (table === 'organization_members') return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: mode === 'quota-precheck' ? [{ organization_id: 'org' }] : [], error: null }) }) }) }) };
    if (table === 'organizations') return { select: () => ({ eq: () => ({ single: async () => {
      quotaReads++;
      return { data: { subscription_status: 'free', free_assessment_trials_used: 5 }, error: null };
    } }) }) };
    if (table === 'teacher_quizzes') {
      const filters: any = {};
      const query: any = { select: () => query, eq: (field: string, value: any) => { filters[field] = value; return query; },
        maybeSingle: async () => {
          lookupCount++; lookups.push({ ...filters });
          if (mode === 'quota-precheck' && quotaReads && !rows.has(filters.id)) rows.set(filters.id, { ...payload, id: filters.id, teacher_id: 'teacher', access_code: '7252', questions: payload.questions });
          const row = rows.get(filters.id);
          // Make two callers both observe the initial absence.
          if (mode === 'duplicate-race' && lookupCount <= 2) return { data: null, error: null };
          return { data: row?.teacher_id === filters.teacher_id ? row : null, error: null };
        },
        insert: (input: any[]) => ({ select: () => ({ single: async () => {
          const saved = { ...input[0], id: input[0].id || `legacy-${inserts.length}`, created_at: '2030-01-01' };
          inserts.push(saved);
          if (rows.has(saved.id)) return { data: null, error: { code: '23505', message: 'duplicate primary key' } };
          rows.set(saved.id, saved);
          if (mode === 'quota-race') return { data: null, error: { message: 'FREE_ASSESSMENT_TRIAL_LIMIT_REACHED' } };
          if (mode === 'lost-response') return { data: null, error: { message: 'response lost after commit' } };
          return { data: saved, error: null };
        } }) }),
      };
      return query;
    }
    throw new Error(`Unexpected ${table}`);
  });
  return { rows, inserts, lookups };
}
beforeEach(() => {
  mockFrom.mockReset();
  jest.spyOn(quizService, 'generateUniqueCode').mockResolvedValue('7252');
  jest.spyOn(quizService, 'notifyCourseStudents').mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('repeated keyed saves return the original exam/code without another insert or notification', async () => {
  const { rows, inserts } = setup();
  const first = await quizService.createQuiz('teacher', payload, key);
  const retry = await quizService.createQuiz('teacher', payload, key);
  expect(retry).toEqual(first);
  expect(first.accessCode).toBe('7252');
  expect(rows.size).toBe(1); expect(inserts).toHaveLength(1);
  expect(quizService.notifyCourseStudents).toHaveBeenCalledTimes(1);
});

it('simultaneous requests converge through the existing exam primary key', async () => {
  const { rows, inserts } = setup('duplicate-race');
  const [first, retry] = await Promise.all([quizService.createQuiz('teacher', payload, key), quizService.createQuiz('teacher', payload, key)]);
  expect(first._id).toBe(retry._id); expect(rows.size).toBe(1); expect(inserts).toHaveLength(2);
  expect(quizService.notifyCourseStudents).toHaveBeenCalledTimes(1);
});

it.each(['quota-race', 'lost-response'] as const)('recovers the saved record after %s instead of encouraging another create', async mode => {
  const { rows } = setup(mode);
  await expect(quizService.createQuiz('teacher', payload, key)).resolves.toMatchObject({ accessCode: '7252' });
  expect(rows.size).toBe(1);
  expect(quizService.notifyCourseStudents).not.toHaveBeenCalled();
});

it('the final free-trial precheck still returns a concurrent completed save', async () => {
  const { inserts } = setup('quota-precheck');
  await expect(quizService.createQuiz('teacher', payload, key)).resolves.toMatchObject({ accessCode: '7252' });
  expect(inserts).toHaveLength(0);
});

it('deliberately creating another identical exam with a new key remains allowed', async () => {
  const { rows } = setup();
  const first = await quizService.createQuiz('teacher', payload, key);
  const next = await quizService.createQuiz('teacher', payload, otherKey);
  expect(first._id).not.toBe(next._id); expect(rows.size).toBe(2);
});

it('keys are scoped to the authenticated teacher and cannot replay another teacher exam', async () => {
  const { lookups } = setup();
  const original = await quizService.createQuiz('teacher', payload, key);
  await expect(quizService.createQuiz('other-teacher', payload, key)).rejects.toMatchObject({ statusCode: 403 });
  expect(lookups[1]).toMatchObject({ teacher_id: 'other-teacher' });
  expect(lookups[1].id).not.toBe(original._id);
});

it('a notification failure after commit still returns the successful exam, including on retry', async () => {
  const { inserts } = setup();
  jest.mocked(quizService.notifyCourseStudents).mockRejectedValue(new Error('notification unavailable'));
  await expect(quizService.createQuiz('teacher', payload, key)).resolves.toMatchObject({ accessCode: '7252' });
  await expect(quizService.createQuiz('teacher', payload, key)).resolves.toMatchObject({ accessCode: '7252' });
  expect(inserts).toHaveLength(1);
});

it('supports MCQ creates and rejects malformed request keys before any database access', async () => {
  setup();
  const mcq = { ...payload, questions: [{ text: 'Choose', questionType: 'multipleChoice' as const, options: ['A', 'B'], correctAnswer: 0, difficulty: 'Easy' }] };
  await expect(quizService.createQuiz('teacher', mcq, key)).resolves.toMatchObject({ questions: mcq.questions });
  mockFrom.mockClear();
  await expect(quizService.createQuiz('teacher', payload, 'invalid')).rejects.toMatchObject({ statusCode: 400 });
  expect(mockFrom).not.toHaveBeenCalled();
});

it('HTTP controller forwards the idempotency header and preserves the teacher identity from auth', async () => {
  setup();
  const app = express(); app.use(express.json());
  app.post('/quizzes', (req: any, _res, next) => { req.user = { _id: 'teacher' }; next(); }, createQuiz);
  app.use(errorHandler);
  const first = await request(app).post('/quizzes').set('Idempotency-Key', key).send({ ...payload, teacherId: 'untrusted' });
  const retry = await request(app).post('/quizzes').set('Idempotency-Key', key).send(payload);
  expect(first.status).toBe(201); expect(retry.status).toBe(201);
  expect(first.body.data._id).toBe(retry.body.data._id);
});
