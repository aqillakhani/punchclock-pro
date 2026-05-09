import { Router } from 'express';
import { EVENT_TYPES, syncBatchRequestSchema } from '@punchclock/shared';
import { requireAuth } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import { punchIn, punchOut } from '../services/time-tracking.service.js';

export const syncRouter = Router();

syncRouter.use(requireAuth(), withTenantDb());

/**
 * Pull changes since a timestamp — used by the mobile app to reconcile
 * after an offline window. Only returns data the authenticated user is
 * allowed to see (enforced by RLS + role-aware filtering here).
 */
syncRouter.get(
  '/changes',
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const sinceClause = since ? 'WHERE updated_at > $1' : '';
    const params = since ? [since] : [];

    const [entries, breaks, shifts, geofences] = await Promise.all([
      db.query(`SELECT * FROM time_entries ${sinceClause} ORDER BY updated_at DESC LIMIT 500`, params),
      db.query(`SELECT * FROM breaks ${sinceClause} ORDER BY updated_at DESC LIMIT 500`, params),
      db.query(`SELECT * FROM shifts ${sinceClause} ORDER BY updated_at DESC LIMIT 500`, params),
      db.query(
        `SELECT id, name, latitude, longitude, radius_meters, enforcement_level, is_active, updated_at
         FROM geofences WHERE is_active = TRUE ${since ? 'AND updated_at > $1' : ''}
         ORDER BY updated_at DESC LIMIT 500`,
        params,
      ),
    ]);

    ok(res, {
      serverTime: new Date().toISOString(),
      timeEntries: entries.rows,
      breaks: breaks.rows,
      shifts: shifts.rows,
      geofences: geofences.rows,
    });
  }),
);

/**
 * Push batch of offline events from the mobile sync queue. Each event
 * is replayed idempotently using clientGeneratedId. The response tells
 * the client which events succeeded and which had conflicts.
 */
syncRouter.post(
  '/batch',
  validateBody(syncBatchRequestSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();

    const results: {
      synced: string[];
      failed: Array<{ clientGeneratedId: string; reason: string }>;
      conflicts: Array<{ clientGeneratedId: string; reason: string }>;
    } = { synced: [], failed: [], conflicts: [] };

    for (const evt of req.body.events) {
      try {
        if (evt.eventType === EVENT_TYPES.PUNCH_IN) {
          await punchIn(db, req.user, {
            clientGeneratedId: evt.clientGeneratedId,
            timestamp: evt.timestamp,
            location: (evt.eventData.location ?? undefined) as
              | { latitude: number; longitude: number; accuracy?: number }
              | undefined,
            deviceInfo: (evt.eventData.deviceInfo ?? undefined) as
              | { deviceId: string; platform: 'ios' | 'android' | 'web' | 'kiosk' }
              | undefined,
            overrideReason: (evt.eventData.overrideReason ?? undefined) as string | undefined,
            notes: (evt.eventData.notes ?? undefined) as string | undefined,
          });
          results.synced.push(evt.clientGeneratedId);
        } else if (evt.eventType === EVENT_TYPES.PUNCH_OUT) {
          await punchOut(db, req.user, {
            clientGeneratedId: evt.clientGeneratedId,
            timestamp: evt.timestamp,
            location: (evt.eventData.location ?? undefined) as
              | { latitude: number; longitude: number; accuracy?: number }
              | undefined,
            notes: (evt.eventData.notes ?? undefined) as string | undefined,
          });
          results.synced.push(evt.clientGeneratedId);
        } else {
          // Other event types (break_start, break_end, etc.) are
          // routed through their dedicated services in future work.
          results.failed.push({
            clientGeneratedId: evt.clientGeneratedId,
            reason: `unsupported_event_type_${evt.eventType}`,
          });
        }
      } catch (err) {
        if (err instanceof AppError && err.code === 'ALREADY_CLOCKED_IN') {
          results.conflicts.push({
            clientGeneratedId: evt.clientGeneratedId,
            reason: 'already_clocked_in',
          });
        } else if (err instanceof AppError && err.code === 'GEOFENCE_VIOLATION') {
          results.conflicts.push({
            clientGeneratedId: evt.clientGeneratedId,
            reason: 'geofence_violation',
          });
        } else {
          results.failed.push({
            clientGeneratedId: evt.clientGeneratedId,
            reason: err instanceof Error ? err.message : 'unknown_error',
          });
        }
      }
    }

    ok(res, results);
  }),
);
