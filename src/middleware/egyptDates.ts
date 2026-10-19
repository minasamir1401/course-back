import { Request, Response, NextFunction } from 'express';
import { parseEgyptDate } from '../utils/egyptTime';

const scheduleKeys = new Set(['startDate', 'endDate', 'publishDate', 'cutOffDate', 'availableFrom', 'availableTo', 'dueDate', 'scheduledAt']);

export function normalizeEgyptSchedules(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeEgyptSchedules);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (scheduleKeys.has(key) && typeof item === 'string' && item) return [key, parseEgyptDate(item).toISOString()];
    return [key, normalizeEgyptSchedules(item)];
  }));
}

export function egyptDates(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !req.is('application/json')) return next();
  try { req.body = normalizeEgyptSchedules(req.body); next(); }
  catch (error: any) { res.status(400).json({ error: error.message, timeZone: 'Africa/Cairo' }); }
}
