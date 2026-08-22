import { Request, Response } from 'express';
import { organizationService } from '../services/organizationService';

const sendError = (res: Response, error: unknown) => {
  const err = error as { message?: string; statusCode?: number };
  res.status(err.statusCode || 500).json({ success: false, error: { message: err.message || 'Organization request failed.' } });
};

export const listOrganizations = async (req: Request, res: Response) => {
  try { res.json({ success: true, data: await organizationService.listForUser(req.user!._id) }); } catch (error) { sendError(res, error); }
};
export const createOrganization = async (req: Request, res: Response) => {
  try { res.status(201).json({ success: true, data: await organizationService.create(req.user!._id, req.body.name) }); } catch (error) { sendError(res, error); }
};
export const listOrganizationMembers = async (req: Request, res: Response) => {
  try { res.json({ success: true, data: await organizationService.listMembers(req.params.organizationId, req.user!._id) }); } catch (error) { sendError(res, error); }
};
export const addOrganizationTeacher = async (req: Request, res: Response) => {
  try { res.status(201).json({ success: true, data: await organizationService.addTeacher(req.params.organizationId, req.user!._id, req.body.email) }); } catch (error) { sendError(res, error); }
};
