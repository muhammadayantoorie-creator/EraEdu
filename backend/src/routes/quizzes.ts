import express from 'express';
import { 
  getQuizForTopic, submitAnswer, getHint, getQuizHistory,
  createQuiz, getTeacherQuizzes, updateQuiz, deleteQuiz, startQuizByCode, submitAllAnswers,
  getAttemptResults, getTeacherSubmissions, getTeacherQuizDetails, gradeSubmission,
  getTeacherAnalytics, getStudentAnalytics
} from '../controllers/quizController';
import {
  generateQuizCode, accessQuizByCode, getQuizCodes, toggleQuizCode, deleteQuizCode
} from '../controllers/quizCodeController';
import {
  reportViolation, getViolations, getViolationSummary, flagAttempt, invalidateAttempt
} from '../controllers/cheatingViolationController';
import { authorize, protect } from '../middleware/auth';

const router = express.Router();

router.use(protect);

// Get quiz history for user
router.get('/history', getQuizHistory);

// Teacher quiz management routes
router.get('/teacher/my-quizzes', authorize('teacher', 'admin'), getTeacherQuizzes);
router.get('/teacher/submissions', authorize('teacher', 'admin'), getTeacherSubmissions);
router.get('/teacher/quiz/:quizId', authorize('teacher', 'admin'), getTeacherQuizDetails);
router.get('/teacher/analytics', authorize('teacher', 'admin'), getTeacherAnalytics);

// Student analytics
router.get('/student/analytics', authorize('student'), getStudentAnalytics);
router.put('/submissions/:submissionId/grade', authorize('teacher', 'admin'), gradeSubmission);

// Adaptive quiz routes for students
router.post('/generate', authorize('student'), getQuizForTopic);

router.post('/', authorize('teacher', 'admin'), createQuiz);
router.put('/:quizId', authorize('teacher', 'admin'), updateQuiz);
router.delete('/:quizId', authorize('teacher', 'admin'), deleteQuiz);

// Quiz Code routes
router.get('/access-by-code/:code', authorize('student'), accessQuizByCode);
router.post('/start-by-code/:code', authorize('student'), startQuizByCode);
router.post('/:attemptId/submit-all', authorize('student'), submitAllAnswers);
router.post('/:quizId/generate-code', authorize('teacher', 'admin'), generateQuizCode);
router.get('/:quizId/codes', authorize('teacher', 'admin'), getQuizCodes);
router.put('/codes/:code/toggle', authorize('teacher', 'admin'), toggleQuizCode);
router.delete('/codes/:code', authorize('teacher', 'admin'), deleteQuizCode);

// Anti-cheating routes
router.post('/attempts/:attemptId/report-violation', authorize('student'), reportViolation);
router.get('/attempts/:attemptId/violations', getViolations);
router.get('/violations/summary', authorize('teacher', 'admin'), getViolationSummary);
router.post('/attempts/:attemptId/flag', authorize('teacher', 'admin'), flagAttempt);
router.post('/attempts/:attemptId/invalidate', authorize('teacher', 'admin'), invalidateAttempt);

// Get quiz for a topic (starts a session essentially)
router.get('/topic/:topicId', authorize('student'), getQuizForTopic);

// Submit single answer
router.post('/:attemptId/question/:questionId/submit', authorize('student'), submitAnswer);

// Get hint
router.get('/question/:questionId/hint', getHint);

// Get specific attempt results
router.get('/attempt/:attemptId/results', getAttemptResults);

export default router;
