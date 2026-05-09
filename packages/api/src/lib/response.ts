import type { Response } from 'express';
import { HTTP_STATUS, type ApiSuccess } from '@punchclock/shared';

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  const body: ApiSuccess<T> = { success: true, data, ...(meta ? { meta } : {}) };
  return res.status(HTTP_STATUS.OK).json(body);
}

export function created<T>(res: Response, data: T): Response {
  const body: ApiSuccess<T> = { success: true, data };
  return res.status(HTTP_STATUS.CREATED).json(body);
}

export function noContent(res: Response): Response {
  return res.status(HTTP_STATUS.NO_CONTENT).send();
}
