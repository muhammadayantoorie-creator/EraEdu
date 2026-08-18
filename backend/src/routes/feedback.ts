import express from 'express';
import { z } from 'zod';
import { protect, authorize } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { submitFeedback } from '../controllers/feedbackController';

const schema = z.object({
  attemptId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  category: z.enum(['overall', 'content', 'usability', 'performance', 'security']),
  liked: z.string().trim().max(1000).optional(),
  improvements: z.string().trim().min(5).max(2000),
  wouldRecommend: z.boolean().optional(),
});

const router = express.Router();
router.post('/', protect, authorize('student'), validateBody(schema), submitFeedback);
export default router;

