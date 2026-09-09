/**
 * Employee-initiated time corrections.
 *
 * The workflow every comparable product ships and this one was missing:
 * a worker who punched wrong (or forgot entirely) asks for a fix and
 * gives a reason; a manager or owner approves or rejects it.
 *
 * Two invariants shape the design.
 *
 * 1. HISTORY IS NEVER REWRITTEN. `time_entry_events` is an append-only
 *    log and approving a correction does not touch the original
 *    punch_in/punch_out rows. The approval appends an `entry_edited`
 *    (or `entry_deleted`) event carrying before/after, and updates the
 *    `time_entries` projection. What the worker actually punched stays
 *    recoverable forever, which is the whole point of event sourcing
 *    for a wage record.
 *
 * 2. NOBODY APPROVES THEIR OWN. A manager may file a correction on
 *    their own timesheet, but somebody else has to approve it. Without
 *    that rule "request a change" is just "change it" with extra steps.
 */
import type { PoolClient } from 'pg';
import {
  CORRECTION_MAX_AGE_DAYS,
  CORRECTION_REQUEST_TYPES,
  CORRECTION_STATUS,
  EVENT_TYPES,
  TIME_ENTRY_STATUS,
  type AuthenticatedUser,
  type CorrectionDecisionInput,
  type CorrectionRequestInput,
} from '@punchclock/shared';
import { AppError } from '../lib/errors.js';
import { publishTimeEvent } from '../events/publisher.js';
import { loadUnpaidBreakMinutes } from './break.service.js';
import { AUDIT_ACTIONS, logAudit, type AuditContext } from './audit.service.js';
import { assertNotInLockedPeriod } from './pay-period.service.js';

export interface CorrectionRow {
  id: string;
  organization_id: string;
  user_id: string;
  requested_by: string;
  time_entry_id: string | null;
  request_type: string;
  original_punch_in_at: string | null;
  original_punch_out_at: string | null;
  requested_punch_in_at: string | null;
  requested_punch_out_at: string | null;
  reason: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS = `
  id, organization_id, user_id, requested_by, time_entry_id, request_type,
  original_punch_in_at, original_punch_out_at,
  requested_punch_in_at, requested_punch_out_at,
  reason, status, decided_by, decided_at, decision_note,
  applied_entry_id, created_at, updated_at`;

/**
 * Minutes a correction would add or remove, so the approver sees the
 * cost of saying yes before they say it. Null when the shift is still
 * open on either side and no comparison is meaningful.
 */
export function computeMinutesDelta(args: {
  originalIn: string | null;
  originalOut: string | null;
  requestedIn: string | null;
  requestedOut: string | null;
  requestType: string;
}): number | null {
  const span = (from: string | null, to: string | null): number | null => {
    if (!from || !to) return null;
    const ms = new Date(to).getTime() - new Date(from).getTime();
    return Number.isFinite(ms) ? Math.round(ms / 60000) : null;
  };

  const before = span(args.originalIn, args.originalOut);

  if (args.requestType === CORRECTION_REQUEST_TYPES.DELETE_ENTRY) {
    return before === null ? null : -before;
  }
  if (args.requestType === CORRECTION_REQUEST_TYPES.ADD_ENTRY) {
    return span(args.requestedIn, args.requestedOut);
  }
  // edit_times: an omitted side means "leave it alone".
  const after = span(args.requestedIn ?? args.originalIn, args.requestedOut ?? args.originalOut);
  if (before === null || after === null) return null;
  return after - before;
}

/** Reject requests about records old enough that payroll has settled. */
function assertWithinCorrectionWindow(punchInAt: string | null, now: Date): void {
  if (!punchInAt) return;
  const ageDays = (now.getTime() - new Date(punchInAt).getTime()) / 86_400_000;
  if (ageDays > CORRECTION_MAX_AGE_DAYS) {
    throw AppError.validation(
      `That shift is more than ${CORRECTION_MAX_AGE_DAYS} days old. Ask a manager to adjust it directly.`,
    );
  }
}

export async function createCorrectionRequest(
  db: PoolClient,
  user: AuthenticatedUser,
  input: CorrectionRequestInput,
  context: AuditContext = {},
): Promise<CorrectionRow> {
  let originalIn: string | null = null;
  let originalOut: string | null = null;
  let subjectUserId = user.userId;

  if (input.timeEntryId) {
    const { rows } = await db.query<{
      id: string;
      user_id: string;
      punch_in_at: string;
      punch_out_at: string | null;
      status: string;
    }>(
      `SELECT id, user_id, punch_in_at, punch_out_at, status
       FROM time_entries WHERE id = $1`,
      [input.timeEntryId],
    );
    const entry = rows[0];
    // RLS already confines this to the caller's org, so a miss here is
    // either a bad id or another tenant's — both are "not found".
    if (!entry) throw AppError.notFound('Time entry');

    // An employee may only ask about their own record. Managers and
    // owners may file on a worker's behalf.
    if (entry.user_id !== user.userId && user.role === 'employee') {
      throw AppError.forbidden('You can only request corrections to your own time entries');
    }
    if (entry.status === TIME_ENTRY_STATUS.DELETED) {
      throw AppError.validation('That time entry has already been removed');
    }

    subjectUserId = entry.user_id;
    originalIn = entry.punch_in_at;
    originalOut = entry.punch_out_at;
    assertWithinCorrectionWindow(entry.punch_in_at, new Date());
    // Refuse early rather than letting someone file a request that could
    // never be approved. Both ends are checked so an entry can be moved
    // neither out of nor into a locked period.
    await assertNotInLockedPeriod(db, [
      entry.punch_in_at,
      input.requestedPunchInAt,
      input.requestedPunchOutAt,
    ]);

    const { rows: pending } = await db.query<{ id: string }>(
      `SELECT id FROM time_correction_requests
       WHERE time_entry_id = $1 AND status = 'pending'`,
      [input.timeEntryId],
    );
    if (pending[0]) {
      throw AppError.conflict('There is already a pending correction for this entry');
    }
  } else {
    // add_entry — the shift being claimed must be inside the window too.
    assertWithinCorrectionWindow(input.requestedPunchInAt ?? null, new Date());
    await assertNotInLockedPeriod(db, [input.requestedPunchInAt, input.requestedPunchOutAt]);
  }

  const { rows } = await db.query<CorrectionRow>(
    `INSERT INTO time_correction_requests
       (organization_id, user_id, requested_by, time_entry_id, request_type,
        original_punch_in_at, original_punch_out_at,
        requested_punch_in_at, requested_punch_out_at, reason, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
     RETURNING ${SELECT_COLUMNS}`,
    [
      user.organizationId,
      subjectUserId,
      user.userId,
      input.timeEntryId ?? null,
      input.requestType,
      originalIn,
      originalOut,
      input.requestedPunchInAt ?? null,
      input.requestedPunchOutAt ?? null,
      input.reason,
    ],
  );
  const created = rows[0]!;

  await logAudit(db, {
    organizationId: user.organizationId,
    actorUserId: user.userId,
    resourceType: 'time_correction_request',
    resourceId: created.id,
    action: AUDIT_ACTIONS.CORRECTION_REQUESTED,
    changes: {
      requestType: created.request_type,
      timeEntryId: created.time_entry_id,
      subjectUserId,
      original: { punchInAt: originalIn, punchOutAt: originalOut },
      requested: {
        punchInAt: created.requested_punch_in_at,
        punchOutAt: created.requested_punch_out_at,
      },
      reason: created.reason,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return created;
}

export async function listMyCorrections(
  db: PoolClient,
  userId: string,
  limit = 100,
): Promise<CorrectionRow[]> {
  const { rows } = await db.query<CorrectionRow>(
    `SELECT ${SELECT_COLUMNS} FROM time_correction_requests
     WHERE user_id = $1 OR requested_by = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows;
}

export async function cancelCorrectionRequest(
  db: PoolClient,
  user: AuthenticatedUser,
  requestId: string,
  context: AuditContext = {},
): Promise<CorrectionRow> {
  const { rows } = await db.query<CorrectionRow>(
    `SELECT ${SELECT_COLUMNS} FROM time_correction_requests WHERE id = $1`,
    [requestId],
  );
  const req = rows[0];
  if (!req) throw AppError.notFound('Correction request');
  if (req.requested_by !== user.userId) {
    throw AppError.forbidden('You can only withdraw your own request');
  }
  if (req.status !== CORRECTION_STATUS.PENDING) {
    throw AppError.conflict(`Request is already ${req.status}`);
  }

  const { rows: updated } = await db.query<CorrectionRow>(
    `UPDATE time_correction_requests
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING ${SELECT_COLUMNS}`,
    [requestId],
  );
  if (!updated[0]) throw AppError.conflict('Request was already decided');

  await logAudit(db, {
    organizationId: user.organizationId,
    actorUserId: user.userId,
    resourceType: 'time_correction_request',
    resourceId: requestId,
    action: AUDIT_ACTIONS.CORRECTION_CANCELLED,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return updated[0];
}

export interface CorrectionQueueRow extends CorrectionRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
  requester_email: string;
  minutes_delta: number | null;
  pay_rate: string | null;
}

export async function listCorrectionQueue(
  db: PoolClient,
  opts: { status?: string; limit?: number } = {},
): Promise<CorrectionQueueRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (opts.status) {
    params.push(opts.status);
    where = `WHERE c.status = $${params.length}`;
  }
  params.push(Math.min(Math.max(opts.limit ?? 200, 1), 500));

  const { rows } = await db.query<CorrectionQueueRow>(
    `SELECT ${SELECT_COLUMNS.split(',')
      .map((c) => `c.${c.trim()}`)
      .join(', ')},
            u.email, u.first_name, u.last_name, u.pay_rate,
            r.email AS requester_email
     FROM time_correction_requests c
     JOIN users u ON u.id = c.user_id
     JOIN users r ON r.id = c.requested_by
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    ...r,
    minutes_delta: computeMinutesDelta({
      originalIn: r.original_punch_in_at,
      originalOut: r.original_punch_out_at,
      requestedIn: r.requested_punch_in_at,
      requestedOut: r.requested_punch_out_at,
      requestType: r.request_type,
    }),
  }));
}

export interface DecisionResult {
  request: CorrectionRow;
  appliedEntryId: string | null;
  minutesDelta: number | null;
}

/**
 * Approve or reject a pending request.
 *
 * On approval the projection is updated and an event appended; on
 * rejection nothing about the time record moves. Either way the
 * decision itself is audited.
 */
export async function decideCorrectionRequest(
  db: PoolClient,
  approver: AuthenticatedUser,
  requestId: string,
  input: CorrectionDecisionInput,
  context: AuditContext = {},
): Promise<DecisionResult> {
  // Lock the row so two managers clicking Approve at the same moment
  // cannot both apply it.
  const { rows } = await db.query<CorrectionRow>(
    `SELECT ${SELECT_COLUMNS} FROM time_correction_requests WHERE id = $1 FOR UPDATE`,
    [requestId],
  );
  const req = rows[0];
  if (!req) throw AppError.notFound('Correction request');
  if (req.status !== CORRECTION_STATUS.PENDING) {
    throw AppError.conflict(`Request is already ${req.status}`);
  }
  if (req.requested_by === approver.userId) {
    throw AppError.forbidden('You cannot decide your own correction request — ask another manager');
  }

  const approved = input.decision === 'approved';
  let appliedEntryId: string | null = null;
  let minutesDelta: number | null = null;

  if (approved) {
    // Re-checked at decision time: a period can be locked between a
    // request being filed and a manager getting to it, and approving
    // then would silently contradict a payroll run.
    await assertNotInLockedPeriod(db, [
      req.original_punch_in_at,
      req.original_punch_out_at,
      input.overridePunchInAt ?? req.requested_punch_in_at,
      input.overridePunchOutAt ?? req.requested_punch_out_at,
    ]);
    // "Approve with modification" — the manager's override wins over
    // what the worker asked for.
    const finalIn = input.overridePunchInAt ?? req.requested_punch_in_at;
    const finalOut = input.overridePunchOutAt ?? req.requested_punch_out_at;

    minutesDelta = computeMinutesDelta({
      originalIn: req.original_punch_in_at,
      originalOut: req.original_punch_out_at,
      requestedIn: finalIn,
      requestedOut: finalOut,
      requestType: req.request_type,
    });

    if (req.request_type === CORRECTION_REQUEST_TYPES.ADD_ENTRY) {
      appliedEntryId = await applyAddEntry(db, req, approver, finalIn, finalOut);
    } else if (req.request_type === CORRECTION_REQUEST_TYPES.DELETE_ENTRY) {
      appliedEntryId = await applyDeleteEntry(db, req, approver);
    } else {
      appliedEntryId = await applyEditTimes(db, req, approver, finalIn, finalOut);
    }
  }

  const { rows: updated } = await db.query<CorrectionRow>(
    `UPDATE time_correction_requests
     SET status = $1, decided_by = $2, decided_at = NOW(),
         decision_note = $3, applied_entry_id = $4, updated_at = NOW()
     WHERE id = $5 AND status = 'pending'
     RETURNING ${SELECT_COLUMNS}`,
    [
      approved ? CORRECTION_STATUS.APPROVED : CORRECTION_STATUS.REJECTED,
      approver.userId,
      input.note ?? null,
      appliedEntryId,
      requestId,
    ],
  );
  if (!updated[0]) throw AppError.conflict('Request was already decided');

  await logAudit(db, {
    organizationId: approver.organizationId,
    actorUserId: approver.userId,
    resourceType: 'time_correction_request',
    resourceId: requestId,
    action: approved ? AUDIT_ACTIONS.CORRECTION_APPROVED : AUDIT_ACTIONS.CORRECTION_REJECTED,
    changes: {
      requestType: req.request_type,
      appliedEntryId,
      minutesDelta,
      note: input.note ?? null,
      overrode: !!(input.overridePunchInAt || input.overridePunchOutAt),
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return { request: updated[0], appliedEntryId, minutesDelta };
}

// ---- Appliers --------------------------------------------------------

/**
 * Recompute payable minutes for an entry from its punches and its
 * unpaid breaks. Shared by every path that moves a punch time.
 */
async function recomputeMinutes(db: PoolClient, entryId: string): Promise<void> {
  const unpaid = await loadUnpaidBreakMinutes(db, entryId);
  await db.query(
    `UPDATE time_entries
     SET gross_minutes = CASE
           WHEN punch_out_at IS NULL THEN NULL
           ELSE GREATEST(0, EXTRACT(EPOCH FROM (punch_out_at - punch_in_at))::int / 60)
         END,
         unpaid_break_minutes = $2,
         duration_minutes = CASE
           WHEN punch_out_at IS NULL THEN NULL
           ELSE GREATEST(0,
             EXTRACT(EPOCH FROM (punch_out_at - punch_in_at))::int / 60 - $2)
         END,
         updated_at = NOW()
     WHERE id = $1`,
    [entryId, unpaid],
  );
}

async function applyEditTimes(
  db: PoolClient,
  req: CorrectionRow,
  approver: AuthenticatedUser,
  finalIn: string | null,
  finalOut: string | null,
): Promise<string> {
  const entryId = req.time_entry_id!;
  const { rows } = await db.query<{
    punch_in_at: string;
    punch_out_at: string | null;
    status: string;
  }>(`SELECT punch_in_at, punch_out_at, status FROM time_entries WHERE id = $1 FOR UPDATE`, [
    entryId,
  ]);
  const entry = rows[0];
  if (!entry) throw AppError.notFound('Time entry');
  if (entry.status === TIME_ENTRY_STATUS.DELETED) {
    throw AppError.conflict('That time entry has been removed');
  }

  const nextIn = finalIn ?? entry.punch_in_at;
  const nextOut = finalOut ?? entry.punch_out_at;
  if (nextOut && new Date(nextOut) <= new Date(nextIn)) {
    throw AppError.validation('The corrected end time must be after the start time');
  }

  // Status stays 'completed' deliberately. Every timesheet and payroll
  // query filters `status='completed'`, so promoting a corrected entry
  // to the 'edited' status would silently drop it out of the worker's
  // hours and out of payroll — the exact opposite of fixing it.
  // Provenance lives in `is_manual`, the appended event, and the audit
  // row, none of which affect what gets paid.
  await db.query(
    `UPDATE time_entries
     SET punch_in_at = $2,
         punch_out_at = $3,
         status = CASE WHEN $3::timestamptz IS NULL THEN 'in_progress'::time_entry_status
                       ELSE 'completed'::time_entry_status END,
         is_manual = TRUE,
         updated_at = NOW()
     WHERE id = $1`,
    [entryId, nextIn, nextOut],
  );
  await recomputeMinutes(db, entryId);

  // Append-only: the original punch events stay untouched.
  await publishTimeEvent(db, {
    organizationId: req.organization_id,
    userId: req.user_id,
    actorUserId: approver.userId,
    eventType: EVENT_TYPES.ENTRY_EDITED,
    eventData: {
      correctionRequestId: req.id,
      changeType: 'edited',
      before: { punchInAt: entry.punch_in_at, punchOutAt: entry.punch_out_at },
      after: { punchInAt: nextIn, punchOutAt: nextOut },
      reason: req.reason,
    },
    timeEntryId: entryId,
    recordedAt: new Date(),
  });

  return entryId;
}

async function applyAddEntry(
  db: PoolClient,
  req: CorrectionRow,
  approver: AuthenticatedUser,
  finalIn: string | null,
  finalOut: string | null,
): Promise<string> {
  if (!finalIn || !finalOut) {
    throw AppError.validation('A missing shift needs both a start and an end time');
  }

  // Refuse to create a shift that overlaps one the worker already has —
  // double-counted hours are worse than a rejected request.
  const { rows: clash } = await db.query<{ id: string }>(
    `SELECT id FROM time_entries
     WHERE user_id = $1
       AND status <> 'deleted'
       AND punch_in_at < $3::timestamptz
       AND COALESCE(punch_out_at, punch_in_at) > $2::timestamptz
     LIMIT 1`,
    [req.user_id, finalIn, finalOut],
  );
  if (clash[0]) {
    throw AppError.conflict('That time overlaps a shift the worker already has');
  }

  // 'completed' so it counts toward hours and payroll like any other
  // finished shift; `is_manual` records that a human created it.
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO time_entries
       (organization_id, user_id, punch_in_at, punch_out_at, status, is_manual, notes)
     VALUES ($1, $2, $3, $4, 'completed', TRUE, $5)
     RETURNING id`,
    [
      req.organization_id,
      req.user_id,
      finalIn,
      finalOut,
      `Added by correction request ${req.id}: ${req.reason}`,
    ],
  );
  const entryId = rows[0]!.id;
  await recomputeMinutes(db, entryId);

  await publishTimeEvent(db, {
    organizationId: req.organization_id,
    userId: req.user_id,
    actorUserId: approver.userId,
    eventType: EVENT_TYPES.ENTRY_EDITED,
    eventData: {
      correctionRequestId: req.id,
      changeType: 'created',
      after: { punchInAt: finalIn, punchOutAt: finalOut },
      reason: req.reason,
    },
    timeEntryId: entryId,
    recordedAt: new Date(),
  });

  return entryId;
}

async function applyDeleteEntry(
  db: PoolClient,
  req: CorrectionRow,
  approver: AuthenticatedUser,
): Promise<string> {
  const entryId = req.time_entry_id!;
  const { rows } = await db.query<{
    punch_in_at: string;
    punch_out_at: string | null;
    duration_minutes: number | null;
  }>(
    `UPDATE time_entries
     SET status = 'deleted', updated_at = NOW()
     WHERE id = $1 AND status <> 'deleted'
     RETURNING punch_in_at, punch_out_at, duration_minutes`,
    [entryId],
  );
  const entry = rows[0];
  if (!entry) throw AppError.conflict('That time entry has already been removed');

  await publishTimeEvent(db, {
    organizationId: req.organization_id,
    userId: req.user_id,
    actorUserId: approver.userId,
    eventType: EVENT_TYPES.ENTRY_DELETED,
    eventData: {
      correctionRequestId: req.id,
      changeType: 'deleted',
      before: {
        punchInAt: entry.punch_in_at,
        punchOutAt: entry.punch_out_at,
        durationMinutes: entry.duration_minutes,
      },
      reason: req.reason,
    },
    timeEntryId: entryId,
    recordedAt: new Date(),
  });

  return entryId;
}

export { recomputeMinutes };
