import type { NextFunction, Request, Response } from 'express';
import { verifyAdminSession } from './tokens.js';

export async function requireOwner(req: Request, res: Response, next: NextFunction) {
  const h = req.header('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await verifyAdminSession(token);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

export const asyncH =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
