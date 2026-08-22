import { Router } from 'express';
import { protect, authorize } from '../middleware/auth';
import { addOrganizationTeacher, createOrganization, listOrganizationMembers, listOrganizations } from '../controllers/organizationController';

const router = Router();
router.use(protect, authorize('teacher', 'admin'));
router.get('/', listOrganizations);
router.post('/', createOrganization);
router.get('/:organizationId/members', listOrganizationMembers);
router.post('/:organizationId/members', addOrganizationTeacher);
export default router;
