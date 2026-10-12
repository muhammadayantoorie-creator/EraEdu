import express from 'express';
import { z } from 'zod';
import { protect, authorize } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { assignAdminCourse, createAdminCourse, getAdminAttempts, getAdminCourseOptions, getAdminCourses, getAdminFeedback, getAdminIntegrityEvents, getAdminOverview, getAdminUsers, updateAdminUser } from '../controllers/adminController';

const router = express.Router();
const accountUpdateSchema = z.object({
  role: z.enum(['student', 'teacher', 'admin']).optional(),
  isSuspended: z.boolean().optional(),
}).strict().refine(value => value.role !== undefined || value.isSuspended !== undefined, {
  message: 'Provide a role or suspension change.',
});
router.use(protect, authorize('admin'));
router.get('/overview', getAdminOverview);
router.get('/attempts', getAdminAttempts);
router.get('/users', getAdminUsers);
router.get('/course-options', getAdminCourseOptions);
router.get('/courses', getAdminCourses);
router.post('/courses', createAdminCourse);
router.patch('/courses/:courseId/assignment', assignAdminCourse);
router.patch('/users/:userId', validateBody(accountUpdateSchema), updateAdminUser);
router.get('/feedback', getAdminFeedback);
router.get('/integrity-events', getAdminIntegrityEvents);
export default router;
