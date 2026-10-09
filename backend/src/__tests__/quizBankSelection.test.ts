process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));

import { normalizeAttemptAnswers, optionOrderForAttempt, quizService, snapshotBankQuestion } from '../services/quizService';

const bankRows = [0, 1, 2].map((index) => ({
  id: `bank-${index}`,
  content: `Question ${index + 1}`,
  question_type: 'multipleChoice',
  options: ['A', 'B', 'C'],
  correct_answer: index,
  difficulty: 'Medium',
  explanation: `Explanation ${index + 1}`,
  topic_id: 'topic-1',
  created_by: 'teacher-1',
}));

function setupBank(rows = bankRows, topicCourseId = 'course-1') {
  let savedQuestions: any[] = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === 'courses') return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'course-1', created_by: 'teacher-1', title: 'Course' }, error: null }) }) }) };
    if (table === 'questions') return { select: () => ({ in: async (_column: string, ids: string[]) => ({ data: rows.filter((row) => ids.includes(row.id)), error: null }) }) };
    if (table === 'topics') return { select: () => ({ in: async () => ({ data: [{ id: 'topic-1', course_id: topicCourseId }], error: null }) }) };
    if (table === 'organization_members') return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
    if (table === 'teacher_quizzes') return { insert: (records: any[]) => {
      savedQuestions = records[0].questions;
      return { select: () => ({ single: async () => ({ data: { ...records[0], id: 'quiz-1', questions: savedQuestions }, error: null }) }) };
    } };
    throw new Error(`Unexpected table ${table}`);
  });
  return () => savedQuestions;
}

beforeEach(() => {
  mockFrom.mockReset();
  jest.spyOn(quizService, 'generateUniqueCode').mockResolvedValue('1234');
  jest.spyOn(quizService, 'notifyCourseStudents').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

const create = (bankQuestionIds: string[], questions: any[] = []) => quizService.createQuiz('teacher-1', {
  title: 'Bank exam', courseId: 'course-1', timeLimit: 3, bankQuestionIds, questions,
});

describe('bank questions in teacher exams', () => {
  it('saves an independent snapshot and grades the three-question variant correctly', async () => {
    const saved = setupBank();
    await create(['bank-0', 'bank-1', 'bank-2']);
    expect(saved()).toHaveLength(3);
    expect(saved()[0]).toMatchObject({ text: 'Question 1', correctAnswer: 0, timeLimit: 60, questionType: 'multipleChoice' });
    const attemptId = 'attempt-1';
    const selected = [1, 0, 2];
    const answers = selected.map((canonical, index) => ({
      questionId: `quiz-1-q${index}`,
      selectedAnswer: optionOrderForAttempt(3, attemptId, index).indexOf(canonical),
    }));
    expect(normalizeAttemptAnswers('quiz-1', attemptId, saved(), answers).score).toBe(1);
    bankRows[0].options[0] = 'Changed after creation';
    expect(saved()[0].options[0]).toBe('A');
    bankRows[0].options[0] = 'A';
  });

  it('keeps manual questions alongside selected bank questions', async () => {
    const saved = setupBank();
    await create(['bank-0'], [{ text: 'Manual', options: ['Yes', 'No'], correctAnswer: 1, difficulty: 'Easy', timeLimit: 90 }]);
    expect(saved().map((question) => question.text)).toEqual(['Manual', 'Question 1']);
  });

  it('rejects duplicate IDs, foreign owners and topics from another course', async () => {
    setupBank();
    await expect(create(['bank-0', 'bank-0'])).rejects.toThrow('unique');
    setupBank([{ ...bankRows[0], created_by: 'teacher-2' }]);
    await expect(create(['bank-0'])).rejects.toThrow('must belong to you');
    setupBank([bankRows[0]], 'course-2');
    await expect(create(['bank-0'])).rejects.toThrow('must belong to you');
  });

  it('rejects unsupported or malformed bank questions', () => {
    expect(() => snapshotBankQuestion({ ...bankRows[0], question_type: 'essay' })).toThrow('unsupported type');
    expect(() => snapshotBankQuestion({ ...bankRows[0], correct_answer: 9 })).toThrow('incompatible');
  });

  it('preserves short-answer questions for manual review', () => {
    expect(snapshotBankQuestion({ ...bankRows[0], question_type: 'shortAnswer', correct_answers: [] })).toMatchObject({
      questionType: 'shortAnswer', options: [], correctAnswer: -1, answerText: '',
    });
  });
});
