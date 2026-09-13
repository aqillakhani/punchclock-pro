/**
 * Time-correction routes.
 *
 * Two routers, mounted separately in app.ts:
 *   meCorrectionsRouter    → /api/v1/me/corrections     (worker side)
 *   adminCorrectionsRouter → /api/v1/admin/corrections  (approver side)
 *                          → /api/v1/admin/time-entries (direct edits)
 *
 * Kept out of me.ts / admin.ts, both of which are already large, so the
 * whole workflow reads top-to-bottom in one place.
 */
import { Router } from 'express';
import {
  PERMISSIONS,
  correctionDecisionSchema,
  correctionRequestSchema,
  timeEntryCreateSchema,
  timeEntryUpdateSchema,
  type CorrectionDecisionInput,
  type CorrectionRequestInput,
  type TimeEntryCreateInput,
  type TimeEntryUpdateInput,
} from '@punchclock/shared';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import { loadEnv } from '../config/env.js';
import {
  cancelCorrectionRequest,
  computeMinutesDelta,
  createCorrectionRequest,
  decideCorrectionRequest,
  listCorrectionQueue,
  listMyCorrections,
  recomputeMinutes,
} from '../services/time-correction.service.js';
import {
  correctionDecisionEmail,
  correctionSubmittedEmail,
  sendEmail,
} from '../services/email.service.js';
import { AUDIT_ACTIONS, diffChanges, logAudit } from '../services/audit.service.js';
import { assertNotInLockedPeriod } from '../services/pay-period.service.js';
import { publishTimeEvent } from '../events/publisher.js';
import { EVENT_TYPES } from '@punchclock/shared';

export const meCorrectionsRouter = Router();
export const adminCorrectionsRouter = Router();

meCorrectionsRouter.use(requireAuth(), withTenantDb());
adminCorrectionsRouter.use(requireAuth(), withTenantDb());

/** Request-scoped bits every audit row wants. */
function auditCtx(req: { ip?: string; headers: Record<string, unknown> }) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}

/** "Mar 2" / "Mar 2 09:00 → 17:30" style label for emails. */
function shiftLabel(punchInAt: string | null, punchOutAt: string | null): string {
  if (!punchInAt) return 'a missing shift';
  const d = new Date(punchInAt);
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const time = (iso: string | null): string =>
    iso
      ? new Date(iso).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC',
        })
      : '—';
  return `${day} (${time(punchInAt)} → ${time(punchOutAt)} UTC)`;
}

function changeLabel(minutesDelta: number | null): string {
  if (minutesDelta === null) return 'time adjusted';
  if (minutesDelta === 0) return 'no change to total hours';
  const sign = minutesDelta > 0 ? '+' : '−';
  const abs = Math.abs(minutesDelta);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const parts = [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null].filter(Boolean).join(' ');
  return `${sign}${parts || '0m'}`;
}

// ---- Worker side -----------------------------------------------------

meCorrectionsRouter.get(
  '/',
  requirePermission(PERMISSIONS.VIEW_TIME_CORRECTION),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const rows = await listMyCorrections(db, req.user.userId);
    ok(
      res,
      rows.map((r) => ({
        ...r,
        minutes_delta: computeMinutesDelta({
          originalIn: r.original_punch_in_at,
          originalOut: r.original_punch_out_at,
          requestedIn: r.requested_punch_in_at,
          requestedOut: r.requested_punch_out_at,
          requestType: r.request_type,
        }),
      })),
      { count: rows.length },
    );
  }),
);

meCorrectionsRouter.post(
  '/',
  requirePermission(PERMISSIONS.SUBMIT_TIME_CORRECTION),
  validateBody(correctionRequestSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const body = req.body as CorrectionRequestInput;

    const row = await createCorrectionRequest(db, req.user, body, auditCtx(req));

    // Notify approvers. Best-effort and fire-and-forget — a slow mail
    // provider must not hold up the worker's submit.
    const { rows: meRows } = await db.query<{
      first_name: string | null;
      last_name: string | null;
    }>(`SELECT first_name, last_name FROM users WHERE id = $1`, [row.user_id]);
    const workerName =
      [meRows[0]?.first_name, meRows[0]?.last_name].filter(Boolean).join(' ').trim() ||
      req.user.email;

    const { rows: approvers } = await db.query<{ email: string }>(
      `SELECT email FROM users
       WHERE role IN ('owner','manager') AND status = 'active' AND deleted_at IS NULL
         AND id <> $1
       LIMIT 5`,
      [req.user.userId],
    );

    const delta = computeMinutesDelta({
      originalIn: row.original_punch_in_at,
      originalOut: row.original_punch_out_at,
      requestedIn: row.requested_punch_in_at,
      requestedOut: row.requested_punch_out_at,
      requestType: row.request_type,
    });
    const reviewUrl = `${loadEnv().WEB_APP_URL}/dashboard/corrections`;
    void Promise.all(
      approvers.map((a) =>
        sendEmail({
          ...correctionSubmittedEmail({
            workerName,
            shiftLabel: shiftLabel(
              row.original_punch_in_at ?? row.requested_punch_in_at,
              row.original_punch_out_at ?? row.requested_punch_out_at,
            ),
            changeLabel: changeLabel(delta),
            reason: row.reason,
            reviewUrl,
          }),
          to: a.email,
        }),
      ),
    );

    created(res, { ...row, minutes_delta: delta });
  }),
);

meCorrectionsRouter.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.SUBMIT_TIME_CORRECTION),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const id = req.params.id;
    if (!id) throw AppError.validation('correction id required');
    const row = await cancelCorrectionRequest(db, req.user, id, auditCtx(req));
    ok(res, row);
  }),
);

// ---- Approver side ---------------------------------------------------

adminCorrectionsRouter.get(
  '/corrections',
  requirePermission(PERMISSIONS.APPROVE_TIME_CORRECTION),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const rows = await listCorrectionQueue(db, { status });
    ok(res, rows, { count: rows.length });
  }),
);

adminCorrectionsRouter.post(
  '/corrections/:id/decision',
  requirePermission(PERMISSIONS.APPROVE_TIME_CORRECTION),
  validateBody(correctionDecisionSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const id = req.params.id;
    if (!id) throw AppError.validation('correction id required');

    const result = await decideCorrectionRequest(
      db,
      req.user,
      id,
      req.body as CorrectionDecisionInput,
      auditCtx(req),
    );

    const { rows: workerRows } = await db.query<{ email: string; first_name: string | null }>(
      `SELECT email, first_name FROM users WHERE id = $1`,
      [result.request.user_id],
    );
    const worker = workerRows[0];
    if (worker) {
      void sendEmail({
        ...correctionDecisionEmail({
          decision: result.request.status === 'approved' ? 'approved' : 'rejected',
          shiftLabel: shiftLabel(
            result.request.original_punch_in_at ?? result.request.requested_punch_in_at,
            result.request.original_punch_out_at ?? result.request.requested_punch_out_at,
          ),
          changeLabel: changeLabel(result.minutesDelta),
          firstName: worker.first_name ?? undefined,
          note: result.request.decision_note ?? undefined,
        }),
        to: worker.email,
      });
    }

    ok(res, {
      ...result.request,
      applied_entry_id: result.appliedEntryId,
      minutes_delta: result.minutesDelta,
    });
  }),
);

// ---- Direct manager edits (no request needed) ------------------------

adminCorrectionsRouter.post(
  '/time-entries',
  requirePermission(PERMISSIONS.EDIT_TIME_ENTRY),
  validateBody(timeEntryCreateSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const body = req.body as TimeEntryCreateInput;

    const { rows: target } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [body.userId],
    );
    if (!target[0]) throw AppError.notFound('User');

    await assertNotInLockedPeriod(db, [body.punchInAt, body.punchOutAt]);

    const { rows: clash } = await db.query<{ id: string }>(
      `SELECT id FROM time_entries
       WHERE user_id = $1
         AND status <> 'deleted'
         AND punch_in_at < COALESCE($3::timestamptz, 'infinity')
         AND COALESCE(punch_out_at, punch_in_at) > $2::timestamptz
       LIMIT 1`,
      [body.userId, body.punchInAt, body.punchOutAt ?? null],
    );
    if (clash[0]) throw AppError.conflict('That time overlaps a shift the worker already has');

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO time_entries
         (organization_id, user_id, punch_in_at, punch_out_at, status, is_manual, notes)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)
       RETURNING id`,
      [
        req.user.organizationId,
        body.userId,
        body.punchInAt,
        body.punchOutAt ?? null,
        body.punchOutAt ? 'completed' : 'in_progress',
        body.notes ?? null,
      ],
    );
    const entryId = rows[0]!.id;
    await recomputeMinutes(db, entryId);

    await publishTimeEvent(db, {
      organizationId: req.user.organizationId,
      userId: body.userId,
      actorUserId: req.user.userId,
      eventType: EVENT_TYPES.ENTRY_EDITED,
      eventData: {
        changeType: 'created',
        after: { punchInAt: body.punchInAt, punchOutAt: body.punchOutAt ?? null },
        reason: body.reason,
      },
      timeEntryId: entryId,
      recordedAt: new Date(),
    });

    await logAudit(db, {
      organizationId: req.user.organizationId,
      actorUserId: req.user.userId,
      resourceType: 'time_entry',
      resourceId: entryId,
      action: AUDIT_ACTIONS.ENTRY_CREATED_MANUAL,
      changes: {
        subjectUserId: body.userId,
        after: { punchInAt: body.punchInAt, punchOutAt: body.punchOutAt ?? null },
        reason: body.reason,
      },
      ...auditCtx(req),
    });

    const { rows: full } = await db.query(`SELECT * FROM time_entries WHERE id = $1`, [entryId]);
    created(res, full[0]);
  }),
);

adminCorrectionsRouter.patch(
  '/time-entries/:id',
  requirePermission(PERMISSIONS.EDIT_TIME_ENTRY),
  validateBody(timeEntryUpdateSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const id = req.params.id;
    if (!id) throw AppError.validation('time entry id required');
    const body = req.body as TimeEntryUpdateInput;

    const { rows: existing } = await db.query<{
      id: string;
      user_id: string;
      punch_in_at: string;
      punch_out_at: string | null;
      notes: string | null;
      status: string;
    }>(
      `SELECT id, user_id, punch_in_at, punch_out_at, notes, status
       FROM time_entries WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const entry = existing[0];
    if (!entry) throw AppError.notFound('Time entry');
    if (entry.status === 'deleted') throw AppError.conflict('That time entry has been removed');

    // Where it is now and where it would move to must both be open.
    await assertNotInLockedPeriod(db, [
      entry.punch_in_at,
      entry.punch_out_at,
      body.punchInAt,
      body.punchOutAt,
    ]);

    const nextIn = body.punchInAt ?? entry.punch_in_at;
    const nextOut = body.punchOutAt ?? entry.punch_out_at;
    if (nextOut && new Date(nextOut) <= new Date(nextIn)) {
      throw AppError.validation('The end time must be after the start time');
    }

    await db.query(
      `UPDATE time_entries
       SET punch_in_at = $2,
           punch_out_at = $3,
           notes = COALESCE($4, notes),
           status = CASE WHEN $3::timestamptz IS NULL THEN 'in_progress'::time_entry_status
                         ELSE 'completed'::time_entry_status END,
           is_manual = TRUE,
           updated_at = NOW()
       WHERE id = $1`,
      [id, nextIn, nextOut, body.notes ?? null],
    );
    await recomputeMinutes(db, id);

    await publishTimeEvent(db, {
      organizationId: req.user.organizationId,
      userId: entry.user_id,
      actorUserId: req.user.userId,
      eventType: EVENT_TYPES.ENTRY_EDITED,
      eventData: {
        changeType: 'edited',
        before: { punchInAt: entry.punch_in_at, punchOutAt: entry.punch_out_at },
        after: { punchInAt: nextIn, punchOutAt: nextOut },
        reason: body.reason,
      },
      timeEntryId: id,
      recordedAt: new Date(),
    });

    await logAudit(db, {
      organizationId: req.user.organizationId,
      actorUserId: req.user.userId,
      resourceType: 'time_entry',
      resourceId: id,
      action: AUDIT_ACTIONS.ENTRY_EDITED,
      changes: {
        subjectUserId: entry.user_id,
        ...diffChanges(
          { punchInAt: entry.punch_in_at, punchOutAt: entry.punch_out_at },
          { punchInAt: nextIn, punchOutAt: nextOut },
        ),
        reason: body.reason,
      },
      ...auditCtx(req),
    });

    const { rows: full } = await db.query(`SELECT * FROM time_entries WHERE id = $1`, [id]);
    ok(res, full[0]);
  }),
);

adminCorrectionsRouter.delete(
  '/time-entries/:id',
  requirePermission(PERMISSIONS.EDIT_TIME_ENTRY),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const id = req.params.id;
    if (!id) throw AppError.validation('time entry id required');
    const reason = typeof req.query.reason === 'string' ? req.query.reason.trim() : '';
    if (!reason) throw AppError.validation('A reason is required to remove a time entry');

    const { rows: target } = await db.query<{ punch_in_at: string; punch_out_at: string | null }>(
      `SELECT punch_in_at, punch_out_at FROM time_entries WHERE id = $1`,
      [id],
    );
    if (!target[0]) throw AppError.notFound('Time entry');
    await assertNotInLockedPeriod(db, [target[0].punch_in_at, target[0].punch_out_at]);

    const { rows } = await db.query<{
      user_id: string;
      punch_in_at: string;
      punch_out_at: string | null;
      duration_minutes: number | null;
    }>(
      `UPDATE time_entries SET status = 'deleted', updated_at = NOW()
       WHERE id = $1 AND status <> 'deleted'
       RETURNING user_id, punch_in_at, punch_out_at, duration_minutes`,
      [id],
    );
    const entry = rows[0];
    if (!entry) throw AppError.notFound('Time entry');

    await publishTimeEvent(db, {
      organizationId: req.user.organizationId,
      userId: entry.user_id,
      actorUserId: req.user.userId,
      eventType: EVENT_TYPES.ENTRY_DELETED,
      eventData: {
        changeType: 'deleted',
        before: {
          punchInAt: entry.punch_in_at,
          punchOutAt: entry.punch_out_at,
          durationMinutes: entry.duration_minutes,
        },
        reason,
      },
      timeEntryId: id,
      recordedAt: new Date(),
    });

    await logAudit(db, {
      organizationId: req.user.organizationId,
      actorUserId: req.user.userId,
      resourceType: 'time_entry',
      resourceId: id,
      action: AUDIT_ACTIONS.ENTRY_DELETED,
      changes: { subjectUserId: entry.user_id, reason },
      ...auditCtx(req),
    });

    ok(res, { id, status: 'deleted' });
  }),
);
