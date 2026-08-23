import express from 'express';
import multer from 'multer';
import { register, login, forgotPassword, resetPassword, getCurrentUser, updateProfile, switchRole, verifyStudentEmailOtp, logout } from '../controllers/authController';
import { uploadProfilePicture, uploadRegistrationPicture } from '../controllers/profilePictureController';
import { protect } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { z } from 'zod';

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });
const forgotPasswordSchema = z.object({ email: z.string().trim().email().max(254) });
const resetPasswordSchema = z.object({ token: z.string().min(1).max(512), password: z.string().min(8).max(128) });
const studentOtpSchema = z.object({ tempToken: z.string().min(1).max(2048), code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code from your email.') });
const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128)
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/\d/, 'Password must contain a number'),
  confirmPassword: z.string().max(128).optional(),
  role: z.enum(['student', 'teacher']).default('student'),
  profilePictureBase64: z.string().max(8_000_000).optional(),
  faceEncoding: z.array(z.number().finite()).max(512).optional(),
}).refine((data) => !data.confirmPassword || data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/jpg'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG and PNG images are allowed'));
    }
  },
});

const router = express.Router();

// Public routes
router.post('/register', validateBody(registerSchema), register);
router.post('/login', validateBody(loginSchema), login);
router.post('/forgot-password', validateBody(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validateBody(resetPasswordSchema), resetPassword);
router.post('/validate-picture', upload.single('profilePicture'), uploadRegistrationPicture);
router.post('/verify-student-otp', validateBody(studentOtpSchema), verifyStudentEmailOtp);
router.post('/logout', logout);

// Protected routes
router.get('/me', protect, getCurrentUser);
router.put('/profile', protect, updateProfile);
router.put('/switch-role', protect, switchRole);
router.post('/upload-profile-picture', protect, upload.single('profilePicture'), uploadProfilePicture);

export default router;
