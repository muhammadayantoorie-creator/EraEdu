import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { feedbackService } from '../services/feedbackService';

export const submitFeedback = asyncHandler(async (req: Request, res: Response) => {
  const data = await feedbackService.submit(req.user!._id, req.body);
  res.status(201).json({ success: true, data, message: 'Thank you for helping us improve EraEdu.' });
});

