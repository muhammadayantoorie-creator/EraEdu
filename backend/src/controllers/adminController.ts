import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { adminService } from '../services/adminService';
import { feedbackService } from '../services/feedbackService';

export const getAdminOverview = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await adminService.getOverview() });
});
export const getAdminUsers = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await adminService.getUsers(String(req.query.search || ''), Number(req.query.limit || 100)) });
});
export const updateAdminUser = asyncHandler(async (req: Request, res: Response) => {
  if (req.params.userId === req.user?._id) throw Object.assign(new Error('You cannot change your own administrator access from this screen'), { statusCode: 400 });
  res.json({ success: true, data: await adminService.updateUser(req.params.userId, req.body) });
});
export const getAdminFeedback = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await feedbackService.getForAdmins(Number(req.query.limit || 100)) });
});
