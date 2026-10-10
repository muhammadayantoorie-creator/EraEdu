import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { adminService } from '../services/adminService';
import { feedbackService } from '../services/feedbackService';
import { courseAssignmentService } from '../services/courseAssignmentService';

export const getAdminOverview = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await adminService.getOverview() });
});
export const getAdminUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.getUsers(String(req.query.search || ''), Number(req.query.page || 1), Number(req.query.limit || 50));
  res.json({ success: true, ...result });
});
export const updateAdminUser = asyncHandler(async (req: Request, res: Response) => {
  if (req.params.userId === req.user?._id) throw Object.assign(new Error('You cannot change your own administrator access from this screen'), { statusCode: 400 });
  res.json({ success: true, data: await adminService.updateUser(req.params.userId, req.body, req.user!._id) });
});
export const getAdminIntegrityEvents = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await adminService.getIntegrityEvents(Number(req.query.limit || 100)) });
});
export const getAdminFeedback = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await feedbackService.getForAdmins(Number(req.query.limit || 100)) });
});
export const getAdminCourseOptions = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await courseAssignmentService.getOptions() });
});
export const getAdminCourses = asyncHandler(async (req: Request, res: Response) => {
  const result = await courseAssignmentService.listCourses(String(req.query.search || ''), Number(req.query.page || 1), Number(req.query.limit || 50));
  res.json({ success: true, ...result });
});
export const createAdminCourse = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await courseAssignmentService.createAssignedCourse(req.user!._id, req.body) });
});
export const assignAdminCourse = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await courseAssignmentService.reassignCourse(req.user!._id, req.params.courseId, req.body) });
});
