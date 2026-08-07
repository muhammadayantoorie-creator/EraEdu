import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';

export const validateBody = <T>(schema: ZodType<T>) => (req: Request, res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ success: false, error: { message: 'Invalid request data', fields: result.error.issues.map((issue) => ({ field: issue.path.join('.') || 'body', message: issue.message })) } });
  }
  req.body = result.data;
  next();
};
