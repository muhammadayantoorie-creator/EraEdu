process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockGenerate = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/aiService', () => ({ aiService: { generateQuestions: mockGenerate } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn().mockResolvedValue(undefined) }));

import { quizService } from '../services/quizService';

const questionRows = Array.from({ length: 5 }, (_, index) => ({
  id: `question-${index}`, topic_id: 'topic-1', content: `Question ${index + 1}`,
  question_type: 'multipleChoice', options: ['A', 'B', 'C'], correct_answer: index % 3,
  difficulty: 'Medium',
}));

function setup({ published = true, quizPublished = true, enrolled = true, questions = questionRows, topic = true } = {}) {
  const attempts: any[] = [];
  const tables: Record<string, any[]> = {
    topics: topic ? [{ id: 'topic-1', title: 'Topic One', course_id: 'course-1' }] : [],
    courses: [{ id: 'course-1', is_published: published }],
    enrollments: enrolled ? [{ id: 'enrollment-1', user_id: 'student-1', course_id: 'course-1' }] : [],
    quizzes: [{ id: 'quiz-1', topic_id: 'topic-1', title: 'Topic Exam', is_published: quizPublished, time_limit: 5 }],
    questions,
    quiz_attempts: attempts,
  };
  mockFrom.mockImplementation((table: string) => {
    if (!tables[table]) throw new Error(`Unexpected table ${table}`);
    const filters: Array<[string, any]> = [];
    let limit: number | undefined;
    let mode: 'read' | 'insert' | 'update' = 'read';
    let inserted: any;
    let changes: any;
    const matching = () => (tables[table] || []).filter((row) => filters.every(([key, value]) => {
      if (key === 'answers' && typeof value === 'string') return JSON.stringify(row.answers) === value;
      return row[key] === value;
    })).slice(0, limit);
    const query: any = {
      select: () => query,
      eq: (key: string, value: any) => { filters.push([key, value]); return query; },
      order: () => query,
      limit: (value: number) => { limit = value; return query; },
      insert: (rows: any[]) => {
        mode = 'insert';
        inserted = { ...rows[0], id: 'attempt-1' };
        attempts.push(inserted);
        return query;
      },
      update: (value: any) => { mode = 'update'; changes = value; return query; },
      maybeSingle: async () => ({ data: matching()[0] || null, error: null }),
      single: async () => ({ data: mode === 'insert' ? inserted : matching()[0] || null, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({
        data: mode === 'update' ? matching().map((row) => { Object.assign(row, changes); return { id: row.id }; }) : matching(),
        error: null,
      }).then(resolve, reject),
    };
    return query;
  });
  return attempts;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockGenerate.mockReset();
  mockGenerate.mockRejectedValue(new Error('AI unavailable'));
});
afterEach(() => jest.useRealTimers());

describe('published topic exam lifecycle', () => {
  it('starts with bank questions, reuses the attempt, grades and returns a result', async () => {
    const attempts = setup();
    const started = await quizService.getQuizForTopic('topic-1', 'student-1');
    expect(started).toMatchObject({ quizId: 'quiz-1', attemptId: 'attempt-1', question: { _id: 'question-0', content: 'Question 1' } });
    expect(JSON.stringify(started)).not.toContain('correctAnswer');
    expect(mockGenerate).not.toHaveBeenCalled();
    const resumed = await quizService.getQuizForTopic('topic-1', 'student-1');
    expect(resumed.attemptId).toBe(started.attemptId);
    expect(attempts).toHaveLength(1);
    for (let index = 0; index < 5; index++) {
      const outcome = await quizService.submitAnswer('attempt-1', `question-${index}`, index === 0 ? 0 : 2, 'student-1');
      expect(outcome.isComplete).toBe(index === 4);
    }
    const result = await quizService.getAttemptResults('attempt-1', 'student-1', 'student');
    expect(result).toMatchObject({ score: 2, maxScore: 5, percentage: 40, reviewPending: false });
    expect(attempts[0].status).toBe('completed');
    await expect(quizService.submitAnswer('attempt-1', 'question-4', 2, 'student-1')).rejects.toThrow('no longer active');
  });

  it('blocks invalid, unpublished and unenrolled starts before creating an attempt', async () => {
    let attempts = setup({ topic: false });
    await expect(quizService.getQuizForTopic('topic-1', 'student-1')).rejects.toThrow('Topic not found');
    expect(attempts).toHaveLength(0);
    attempts = setup({ published: false });
    await expect(quizService.getQuizForTopic('topic-1', 'student-1')).rejects.toThrow('not published');
    expect(attempts).toHaveLength(0);
    attempts = setup({ enrolled: false });
    await expect(quizService.getQuizForTopic('topic-1', 'student-1')).rejects.toThrow('not enrolled');
    expect(attempts).toHaveLength(0);
    attempts = setup({ quizPublished: false });
    await expect(quizService.getQuizForTopic('topic-1', 'student-1')).rejects.toThrow('No published exam');
    expect(attempts).toHaveLength(0);
  });

  it('fails clearly when no usable questions or AI are available', async () => {
    const attempts = setup({ questions: [] });
    await expect(quizService.getQuizForTopic('topic-1', 'student-1')).rejects.toThrow('No usable questions');
    expect(attempts).toHaveLength(0);
  });

  it('uses existing questions when AI fails to fill the remaining slots', async () => {
    const attempts = setup({ questions: questionRows.slice(0, 2) });
    await quizService.getQuizForTopic('topic-1', 'student-1');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(attempts[0].max_score).toBe(2);
  });

  it('keeps the first question deadline across refresh and rejects a late changed answer', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    setup();
    await quizService.getQuizForTopic('topic-1', 'student-1');
    jest.advanceTimersByTime(20_000);
    expect((await quizService.getCurrentTopicQuestion('attempt-1', 'student-1')).question?.remainingSeconds).toBe(40);
    jest.advanceTimersByTime(41_000);
    expect((await quizService.getCurrentTopicQuestion('attempt-1', 'student-1')).question?.remainingSeconds).toBe(0);
    await expect(quizService.submitAnswer('attempt-1', 'question-0', 0, 'student-1')).rejects.toThrow('expired');
    await expect(quizService.submitAnswer('attempt-1', 'question-0', -1, 'student-1')).resolves.toMatchObject({ isCorrect: false });
  });

  it('enforces attempt ownership and current-question order', async () => {
    setup();
    await quizService.getQuizForTopic('topic-1', 'student-1');
    await expect(quizService.getCurrentTopicQuestion('attempt-1', 'student-2')).rejects.toThrow('Not authorized');
    await expect(quizService.submitAnswer('attempt-1', 'question-0', 0, 'student-2')).rejects.toThrow('Not authorized');
    await expect(quizService.submitAnswer('attempt-1', 'question-1', 0, 'student-1')).rejects.toThrow('current question');
    await expect(quizService.submitAnswer('attempt-1', 'question-0', 99, 'student-1')).rejects.toThrow('out of range');
    await expect(quizService.getAttemptResults('attempt-1', 'student-2', 'student')).rejects.toThrow('Unauthorized');
  });
});
