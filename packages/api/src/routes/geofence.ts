import { Router } from 'express';
import { PERMISSIONS, geofenceCreateSchema } from '@punchclock/shared';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, noContent, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';

export const geofenceRouter = Router();

geofenceRouter.use(requireAuth(), withTenantDb());

geofenceRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const { rows } = await db.query(
      `SELECT id, name, latitude, longitude, radius_meters, enforcement_level, is_active, created_at
       FROM geofences ORDER BY name ASC`,
    );
    ok(res, rows);
  }),
);

geofenceRouter.post(
  '/',
  requirePermission(PERMISSIONS.EDIT_GEOFENCE),
  validateBody(geofenceCreateSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const { rows } = await db.query(
      `INSERT INTO geofences
         (organization_id, name, latitude, longitude, radius_meters, enforcement_level, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, latitude, longitude, radius_meters, enforcement_level, is_active, created_at`,
      [
        req.user.organizationId,
        req.body.name,
        req.body.latitude,
        req.body.longitude,
        req.body.radiusMeters,
        req.body.enforcementLevel,
        req.body.isActive,
      ],
    );
    created(res, rows[0]);
  }),
);

geofenceRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.EDIT_GEOFENCE),
  validateBody(geofenceCreateSchema.partial()),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const fields: string[] = [];
    const values: unknown[] = [];
    const mapping: Record<string, string> = {
      name: 'name',
      latitude: 'latitude',
      longitude: 'longitude',
      radiusMeters: 'radius_meters',
      enforcementLevel: 'enforcement_level',
      isActive: 'is_active',
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (key in req.body) {
        values.push(req.body[key]);
        fields.push(`${column} = $${values.length}`);
      }
    }
    if (fields.length === 0) throw AppError.validation('No updatable fields');
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE geofences SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, name, latitude, longitude, radius_meters, enforcement_level, is_active`,
      values,
    );
    if (rows.length === 0) throw AppError.notFound('Geofence');
    ok(res, rows[0]);
  }),
);

geofenceRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.EDIT_GEOFENCE),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const result = await db.query('DELETE FROM geofences WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) throw AppError.notFound('Geofence');
    noContent(res);
  }),
);
