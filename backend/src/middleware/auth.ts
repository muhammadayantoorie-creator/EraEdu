import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/environment';
import { authService } from '../services/authService';
import { supabase } from '../config/supabase';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        _id: string;
        role: string;
      };
    }
  }
}

export const protect = async (req: Request, res: Response, next: NextFunction) => {
  let token;

  token = req.cookies?.eraedu_session;
  if (!token && req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as any;
      // Re-check governance state on every authenticated request so an
      // existing session cannot continue after a manual suspension or role change.
      const { data: liveUser, error } = await supabase.from('users')
        .select('id, role, is_suspended').eq('id', decoded.id).single();
      if (error || !liveUser) return res.status(401).json({ message: 'Not authorized, user unavailable' });
      if (liveUser.is_suspended) return res.status(403).json({ message: 'This account has been suspended. Please contact support.' });
      req.user = { _id: liveUser.id, role: liveUser.role };
      return next();
    } catch {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `User role ${req.user?.role} is not authorized to access this route` 
      });
    }
    next();
  };
};
