import { Request, Response } from 'express';
import { quizService } from '../services/quizService';
import { asyncHandler } from '../middleware/errorHandler';

// Teacher endpoints
export const createQuiz = asyncHandler(async (req: Request, res: Response) => {
  const { title, description, timeLimit, scheduledStart, questions, bankQuestionIds, courseId, cameraMonitoring, violationLimit } = req.body;
  const teacherId = req.user!._id.toString();

  const quiz = await quizService.createQuiz(teacherId, {
    title,
    description,
    timeLimit,
    scheduledStart,
    courseId,
    questions,
    bankQuestionIds,
    cameraMonitoring,
    violationLimit,
  }, req.get('Idempotency-Key'));

  res.status(201).json({
    success: true,
    data: quiz,
  });
});

export const getTeacherQuizzes = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.user!._id.toString();
  const quizzes = await quizService.getTeacherQuizzes(teacherId);

  res.status(200).json({
    success: true,
    data: quizzes,
  });
});

export const updateQuiz = asyncHandler(async (req: Request, res: Response) => {
  const { quizId } = req.params;
  const { title, description, timeLimit, scheduledStart, questions, cameraMonitoring, violationLimit } = req.body;
  const teacherId = req.user!._id.toString();

  const quiz = await quizService.updateQuiz(quizId, teacherId, {
    title,
    description,
    timeLimit,
    scheduledStart,
    questions,
    cameraMonitoring,
    violationLimit,
  });

  res.status(200).json({
    success: true,
    data: quiz,
  });
});

export const deleteQuiz = asyncHandler(async (req: Request, res: Response) => {
  const { quizId } = req.params;
  const teacherId = req.user!._id.toString();

  await quizService.deleteQuiz(quizId, teacherId);

  res.status(200).json({
    success: true,
    message: 'Exam deleted successfully',
  });
});

export const startQuizByCode = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params;
  const userId = req.user!._id.toString();

  const result = await quizService.startQuizByCode(code, userId);

  res.status(200).json({
    success: true,
    data: result,
  });
});

export const submitAllAnswers = asyncHandler(async (req: Request, res: Response) => {
  const { attemptId } = req.params;
  const { answers, violations } = req.body;
  const userId = req.user!._id.toString();

  if (!Array.isArray(answers)) {
    res.status(400).json({ success: false, error: { message: 'Answers must be an array' } });
    return;
  }

  const result = await quizService.submitAllAnswers(attemptId, userId, answers, violations);

  res.status(200).json({
    success: true,
    data: result,
  });
});

// Code-based teacher exams use a different lifecycle from topic exams. These
// endpoints return only a public attempt variant; snapshot answer keys remain
// server-only.
export const getActiveTeacherAttempt = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const result = await quizService.getActiveTeacherAttempt(req.params.attemptId, userId);
  res.status(200).json({ success: true, data: result });
});

export const activateTeacherAttemptQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const { questionId } = req.body;
  if (typeof questionId !== 'string') {
    res.status(400).json({ success: false, error: { message: 'questionId is required' } });
    return;
  }
  const result = await quizService.activateTeacherAttemptQuestion(req.params.attemptId, userId, questionId);
  res.status(200).json({ success: true, data: result });
});

export const saveTeacherAttemptAnswer = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const { questionId, selectedAnswer } = req.body;
  if (typeof questionId !== 'string' || (typeof selectedAnswer !== 'number' && typeof selectedAnswer !== 'string')) {
    res.status(400).json({ success: false, error: { message: 'questionId and selectedAnswer are required' } });
    return;
  }
  const result = await quizService.saveTeacherAttemptAnswer(
    req.params.attemptId,
    userId,
    questionId,
    selectedAnswer,
  );
  res.status(200).json({ success: true, data: result });
});

export const getAttemptResults = asyncHandler(async (req: Request, res: Response) => {
  const { attemptId } = req.params;
  const userId = req.user!._id.toString();
  const userRole = req.user!.role;

  const result = await quizService.getAttemptResults(attemptId, userId, userRole);

  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getTeacherSubmissions = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.user!._id.toString();
  const submissions = await quizService.getTeacherSubmissions(teacherId);

  res.status(200).json({
    success: true,
    data: submissions,
  });
});

export const getTeacherQuizDetails = asyncHandler(async (req: Request, res: Response) => {
  const { quizId } = req.params;
  const teacherId = req.user!._id.toString();

  const quiz = await quizService.getTeacherQuizDetails(quizId, teacherId);

  res.status(200).json({
    success: true,
    data: quiz,
  });
});

export const gradeSubmission = asyncHandler(async (req: Request, res: Response) => {
  const { submissionId } = req.params;
  const { grade, feedback } = req.body;
  const teacherId = req.user!._id.toString();

  await quizService.gradeSubmission(submissionId, teacherId, grade, feedback);

  res.status(200).json({
    success: true,
    message: 'Grade saved successfully',
  });
});

export const getTeacherAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.user!._id.toString();
  const analytics = await quizService.getTeacherAnalytics(teacherId);

  res.status(200).json({
    success: true,
    data: analytics,
  });
});

export const getStudentAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const analytics = await quizService.getStudentAnalytics(userId);

  res.status(200).json({
    success: true,
    data: analytics,
  });
});

export const getQuizForTopic = asyncHandler(async (req: Request, res: Response) => {
  const topicId = req.params.topicId || req.body?.topicId;
  const difficulty = req.body?.difficulty || req.query.difficulty;
  if (typeof topicId !== 'string' || !topicId) {
    res.status(400).json({ success: false, message: 'Topic ID is required' });
    return;
  }
  
  const result = await quizService.getQuizForTopic(
    topicId,
    req.user!._id.toString(),
    difficulty as string
  );
  
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getCurrentTopicQuestion = asyncHandler(async (req: Request, res: Response) => {
  const result = await quizService.getCurrentTopicQuestion(req.params.attemptId, req.user!._id.toString());
  res.status(200).json({ success: true, data: result });
});

export const submitAnswer = asyncHandler(async (req: Request, res: Response) => {
  const { attemptId } = req.params;
  const { questionId, selectedAnswer } = req.body;
  
  const result = await quizService.submitAnswer(
    attemptId,
    questionId,
    selectedAnswer,
    req.user!._id,
  );
  
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getHint = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;
  const hint = await quizService.getHint(questionId);
  
  res.status(200).json({
    success: true,
    data: { hint },
  });
});

export const getQuizHistory = asyncHandler(async (req: Request, res: Response) => {
  const history = await quizService.getQuizHistory(req.user!._id.toString());
  
  res.status(200).json({
    success: true,
    data: history,
  });
});
