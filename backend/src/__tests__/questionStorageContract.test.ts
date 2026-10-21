process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'question-storage-test-secret-minimum-32-characters';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-key';
const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
import { questionService } from '../services/questionService';
import { quizService } from '../services/quizService';
const input = { topicId: 'topic', questionText: 'Pick one', questionType: 'multipleChoice' as const,
  options: ['Alpha', 'Beta'], correctAnswer: 0, explanation: 'Explanation', difficulty: 'Easy' as const, createdBy: 'teacher' };
function setup(question: any = {}, error: any = null) {
  const stored: any = { id: 'question', created_by: 'teacher', question_type: 'multipleChoice', options: ['Alpha', 'Beta'], correct_answer: 1, ...question };
  const write = jest.fn((data: any) => { Object.assign(stored, Array.isArray(data) ? data[0] : data); return query; });
  const query: any = { select: () => query, eq: () => query, insert: write, update: write,
    single: async () => ({ data: error ? null : stored, error }) };
  mockFrom.mockImplementation(table => {
    if (table === 'questions') return query;
    const result = table === 'topics' ? { course_id: 'course' } : { created_by: 'teacher' };
    return { select: () => ({ eq: () => ({ single: async () => ({ data: result, error: null }) }) }) };
  });
  return { stored, write };
}
beforeEach(() => mockFrom.mockReset());
test.each([0, 'Alpha', 'Beta'])('question creation stores an integer option index for %s', async answer => {
  const { stored, write } = setup();
  await questionService.createQuestion({ ...input, correctAnswer: answer });
  expect(stored.correct_answer).toBe(answer === 'Beta' ? 1 : 0);
  expect(stored.explanation).toBe('Explanation');
  expect(write.mock.calls[0][0][0]).not.toHaveProperty('hint');
});
test.each([-1, 3, 'Not an option'])('invalid correct answers fail before any write (%s)', async answer => {
  const { write } = setup();
  await expect(questionService.createQuestion({ ...input, correctAnswer: answer })).rejects.toMatchObject({ statusCode: 400 });
  expect(write).not.toHaveBeenCalled();
});
test('editing can select the first answer and clear an explanation', async () => {
  const { stored } = setup({ explanation: 'Old explanation' });
  await questionService.updateQuestion('question', { correctAnswer: 0, explanation: '' }, 'teacher', 'teacher');
  expect(stored.correct_answer).toBe(0);
  expect(stored.explanation).toBe('');
});
test('short answers keep their accepted answers and use nullable integer answer storage', async () => {
  const { stored } = setup();
  await questionService.createQuestion({ ...input, questionType: 'shortAnswer', correctAnswers: ['Answer'], correctAnswer: undefined });
  expect(stored).toMatchObject({ correct_answer: null, correct_answers: ['Answer'], options: [], explanation: 'Explanation' });
});
test.each([
  [{ explanation: 'Canonical' }, 'Canonical'],
  [{ explanation: null, hint: 'Legacy' }, 'Legacy'],
  [{ explanation: '', hint: 'Stale legacy' }, 'No hint available.'],
])('hints read the canonical schema and preserve optional legacy values (%j)', async (row, expected) => {
  setup(row);
  await expect(quizService.getHint('question')).resolves.toBe(expected);
});
test('hint lookup failures remain unavailable instead of looking like a legitimately empty hint', async () => {
  setup({}, { message: 'Database unavailable' });
  await expect(quizService.getHint('question')).rejects.toMatchObject({ statusCode: 503 });
});
