process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
import { quizService } from '../services/quizService';

const payload = { title: 'Exam', courseId: 'course', timeLimit: 3, cameraMonitoring: false, violationLimit: 7,
  questions: [{ text: 'Question', options: ['A','B'], correctAnswer: 0, difficulty: 'Easy', timeLimit: 60 }] };
function setup(error: any = null) {
  let saved: any;
  const write = jest.fn((input: any) => { saved = Array.isArray(input) ? input[0] : input; return query; });
  const eq = jest.fn(() => query);
  const query: any = { insert: write, update: write, select: () => query, eq,
    single: async () => ({ data: error ? null : { id: 'exam', ...saved }, error }) };
  mockFrom.mockImplementation(table => {
    if (table === 'teacher_quizzes') return query;
    if (table === 'courses') return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'course', created_by: 'teacher', title: 'Course' }, error: null }) }) }) };
    if (table === 'organization_members') return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
    throw new Error(`Unexpected ${table}`);
  });
  return { write, eq };
}
beforeEach(() => {
  mockFrom.mockReset();
  jest.spyOn(quizService, 'generateUniqueCode').mockResolvedValue('CODE');
  jest.spyOn(quizService, 'notifyCourseStudents').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());
test.each(['camera_monitoring','course_id','violation_limit'])('create/edit fail once with actionable schema requirement for %s', async column => {
  for (const action of ['create', 'update']) {
    const { write } = setup({ code: '42703', message: `column teacher_quizzes.${column} does not exist` });
    const call = action === 'create' ? quizService.createQuiz('teacher', payload) : quizService.updateQuiz('exam','teacher',payload);
    await expect(call).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('016_complete_teacher_quiz_schema.sql') });
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(write.mock.calls[0])).toContain('camera_monitoring');
    expect(JSON.stringify(write.mock.calls[0])).toContain('violation_limit');
  }
});
test('unrelated missing columns are not misdiagnosed as monitoring settings or retried', async () => {
  const { write } = setup({ code: '42703', message: 'column unrelated_field does not exist' });
  await expect(quizService.updateQuiz('exam','teacher',payload)).rejects.toThrow('unrelated_field');
  expect(write).toHaveBeenCalledTimes(1);
});
test('PostgREST schema-cache errors identify the actual missing setting', async () => {
  setup({ code: 'PGRST204', message: "Could not find the 'camera_monitoring' column in the schema cache" });
  await expect(quizService.createQuiz('teacher',payload)).rejects.toMatchObject({ statusCode: 503 });
});
test('successful saves retain monitoring choices and current-teacher update predicate', async () => {
  const { eq } = setup();
  await expect(quizService.createQuiz('teacher',payload)).resolves.toMatchObject({ cameraMonitoring: false, violationLimit: 7, courseId: 'course' });
  await expect(quizService.updateQuiz('exam','teacher',payload)).resolves.toMatchObject({ cameraMonitoring: false, violationLimit: 7 });
  expect(eq).toHaveBeenCalledWith('teacher_id','teacher');
});
