import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { asyncHandler } from '../middleware/errorHandler';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body);
  
  res.status(201).json({
    success: true,
    data: result,
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body);
  
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.requestPasswordReset(req.body.email);

  res.status(200).json({
    success: true,
    data: result,
  });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.resetPassword(req.body.token, req.body.password);

  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getCurrentUser = asyncHandler(async (req: Request, res: Response) => {
  // req.user is attached by auth middleware
  const user = await authService.getCurrentUser(req.user!._id.toString());
  
  res.status(200).json({
    success: true,
    data: user,
  });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.updateProfile(req.user!._id.toString(), req.body);
  
  res.status(200).json({
    success: true,
    data: user,
  });
});

export const verifyFaceLogin = asyncHandler(async (req: Request, res: Response) => {
  const { tempToken, faceEncoding } = req.body;

  if (!tempToken || !faceEncoding) {
    res.status(400).json({
      success: false,
      error: { message: 'tempToken and faceEncoding are required' },
    });
    return;
  }

  const result = await authService.verifyFaceLogin(tempToken, faceEncoding);

  res.status(200).json({
    success: true,
    data: result,
  });
});

export const switchRole = asyncHandler(async (req: Request, res: Response) => {
  // Roles are an authorization boundary. Allowing a user to choose their own
  // role lets a student promote themselves to teacher and access assessment
  // authoring data. Role changes must go through the admin management flow.
  res.status(403).json({
    success: false,
    message: 'Self-service role changes are disabled. Contact an administrator.',
  });
});
