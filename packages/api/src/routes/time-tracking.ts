import { Router } from 'express';
import {
  breakEndRequestSchema,
  breakStartRequestSchema,
  geofenceValidateRequestSchema,
  punchInRequestSchema,
  punchOutRequestSchema,
} from '@punchclock/shared';
import { requireAuth } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import {
  getCurrentOpenEntry,
  listEntries,
  punchIn,
  punchOut,
} from '../services/time-tracking.service.js';
import { endBreak, startBreak } from '../services/break.service.js';
import { evaluateGeofence } from '../services/geofence.service.js';

export const timeTrackingRouter = Router();

timeTrackingRouter.use(requireAuth(), withTenantDb());

timeTrackingRouter.post(
  '/punch-in',
  validateBody(punchInRequestSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const result = await punchIn(db, req.user, req.body, { clientIp: req.ip ?? null });
    created(res, result);
  }),
);

timeTrackingRouter.post(
  '/punch-out',
  validateBody(punchOutRequestSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const result = await punchOut(db, req.user, req.body);
    ok(res, result);
  }),
);

timeTrackingRouter.get(
  '/current',
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const entry = await getCurrentOpenEntry(db, req.user.userId);
    ok(res, { entry });
  }),
);

timeTrackingRouter.get(
  '/entries',
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const entries = await listEntries(db, req.user, {
      userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
      fromDate: typeof req.query.from === 'string' ? req.query.from : undefined,
      toDate: typeof req.query.to === 'string' ? req.query.to : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    ok(res, entries, { count: entries.length });
  }),
);

timeTrackingRouter.post(
  '/breaks',
  validateBody(breakStartRequestSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const brk = await startBreak(db, req.user, req.body);
    created(res, brk);
  }),
);

timeTrackingRouter.post(
  '/breaks/:id/end',
  validateBody(breakEndRequestSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const brk = await endBreak(db, req.user, {
      breakId: req.params.id as string,
      timestamp: req.body.timestamp,
      clientGeneratedId: req.body.clientGeneratedId,
    });
    ok(res, brk);
  }),
);

timeTrackingRouter.post(
  '/geofence/validate',
  validateBody(geofenceValidateRequestSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const decision = await evaluateGeofence(db, req.body.location);
    ok(res, {
      inside: decision.inside,
      distanceMeters: Number.isFinite(decision.distanceMeters) ? decision.distanceMeters : null,
      geofenceId: decision.geofence?.id ?? null,
      enforcementLevel: decision.enforcementLevel,
      allowed: decision.allowed,
      reason: decision.reason,
    });
  }),
);
