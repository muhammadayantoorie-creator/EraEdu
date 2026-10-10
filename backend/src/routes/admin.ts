import express from 'express';
import { protect, authorize } from '../middleware/auth';
import { assignAdminCourse, createAdminCourse, getAdminCourseOptions, getAdminCourses, getAdminFeedback, getAdminIntegrityEvents, getAdminOverview, getAdminUsers, updateAdminUser } from '../controllers/adminController';

const router = express.Router();
router.use(protect, authorize('admin'));
router.get('/overview', getAdminOverview);
router.get('/users', getAdminUsers);
router.get('/course-options', getAdminCourseOptions);
router.get('/courses', getAdminCourses);
router.post('/courses', createAdminCourse);
router.patch('/courses/:courseId/assignment', assignAdminCourse);
router.patch('/users/:userId', updateAdminUser);
router.get('/feedback', getAdminFeedback);
router.get('/integrity-events', getAdminIntegrityEvents);
export default router;
