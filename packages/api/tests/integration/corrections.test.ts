/**
 * The time-correction workflow, end to end.
 *
 * Covers the request → decision lifecycle for all three request types,
 * the authorization boundaries around it, and — most importantly — the
 * guarantee that approving a correction never rewrites the immutable
 * event log.
 */
import request from 'supertest';
import {
  testApp,
  seedOrg,
  dropOrg,
  insertCompletedEntry,
  queryAsSystem,
  assertDbReady,
  closePool,
  type SeededOrg,
} from './helpers/harness.js';

const app = testApp();
let org: SeededOrg;

beforeAll(async () => {
  await assertDbReady();
  org = await seedOrg('corrections');
});

afterAll(async () => {
  if (org) await dropOrg(org.id);
  await closePool();
});

/** Recent enough to sit inside CORRECTION_MAX_AGE_DAYS. */
function daysAgo(n: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function newEntry(userId: string, dayOffset: number): Promise<string> {
  return insertCompletedEntry(org.id, userId, daysAgo(dayOffset, 9), daysAgo(dayOffset, 17));
}

describe('filing a correction request', () => {
  it('lets an employee request an edit with a reason', async () => {
    const entryId = await newEntry(org.employee.id, 3);

    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: daysAgo(3, 18),
        reason: 'Forgot to clock out when the shift ran late.',
      })
      .expect(201);

    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.reason).toContain('Forgot to clock out');
    // Snapshot of the record as filed, for the approver's diff.
    expect(res.body.data.original_punch_out_at).not.toBeNull();
    // 09:00→17:00 becomes 09:00→18:00, so one more hour.
    expect(res.body.data.minutes_delta).toBe(60);
  });

  it('refuses a request with no reason', async () => {
    const entryId = await newEntry(org.employee.id, 4);
    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: daysAgo(4, 18),
        reason: '   ',
      })
      .expect(422);
  });

  it('refuses an edit that changes nothing', async () => {
    const entryId = await newEntry(org.employee.id, 5);
    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({ requestType: 'edit_times', timeEntryId: entryId, reason: 'nothing specified' })
      .expect(422);
  });

  it('refuses an end time at or before the start time', async () => {
    const entryId = await newEntry(org.employee.id, 6);
    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchInAt: daysAgo(6, 17),
        requestedPunchOutAt: daysAgo(6, 9),
        reason: 'backwards',
      })
      .expect(422);
  });

  it("refuses a request against a coworker's entry", async () => {
    const coworkerEntry = await newEntry(org.coworker.id, 3);
    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: coworkerEntry,
        requestedPunchOutAt: daysAgo(3, 20),
        reason: 'not my shift',
      })
      .expect(403);
  });

  it('refuses a second pending request for the same entry', async () => {
    const entryId = await newEntry(org.employee.id, 7);
    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: daysAgo(7, 18),
        reason: 'first',
      })
      .expect(201);

    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: daysAgo(7, 19),
        reason: 'second',
      })
      .expect(409);
  });

  it('refuses a correction to a shift older than the window', async () => {
    const oldEntry = await insertCompletedEntry(
      org.id,
      org.employee.id,
      daysAgo(120, 9),
      daysAgo(120, 17),
    );
    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: oldEntry,
        requestedPunchOutAt: daysAgo(120, 18),
        reason: 'ancient',
      })
      .expect(422);
  });

  it('rejects a viewer outright', async () => {
    const entryId = await newEntry(org.employee.id, 8);
    const viewer = await seedOrg('corrections-viewer');
    try {
      await request(app)
        .post('/api/v1/me/corrections')
        .set('Authorization', viewer.employee.auth)
        .send({
          requestType: 'edit_times',
          timeEntryId: entryId,
          requestedPunchOutAt: daysAgo(8, 18),
          reason: 'x',
        })
        // Cross-tenant: the entry is invisible, so 404 not 403.
        .expect(404);
    } finally {
      await dropOrg(viewer.id);
    }
  });
});

describe('approving an edit', () => {
  let entryId: string;
  let requestId: string;

  beforeAll(async () => {
    entryId = await newEntry(org.employee.id, 10);
    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: daysAgo(10, 18),
        reason: 'Stayed an extra hour to close.',
      })
      .expect(201);
    requestId = res.body.data.id;
  });

  it('shows up in the approver queue with a diff and an hours delta', async () => {
    const res = await request(app)
      .get('/api/v1/admin/corrections?status=pending')
      .set('Authorization', org.manager.auth)
      .expect(200);

    const mine = (res.body.data as { id: string; minutes_delta: number; email: string }[]).find(
      (r) => r.id === requestId,
    );
    expect(mine).toBeDefined();
    expect(mine!.minutes_delta).toBe(60);
    expect(mine!.email).toBe(org.employee.email);
  });

  it('is invisible to an employee', async () => {
    await request(app)
      .get('/api/v1/admin/corrections?status=pending')
      .set('Authorization', org.employee.auth)
      .expect(403);
  });

  it('applies the new time and recomputes payable minutes', async () => {
    await request(app)
      .post(`/api/v1/admin/corrections/${requestId}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'approved', note: 'Confirmed with the closing checklist.' })
      .expect(200);

    const rows = await queryAsSystem<{
      punch_out_at: string;
      duration_minutes: number;
      gross_minutes: number;
      status: string;
      is_manual: boolean;
    }>(
      `SELECT punch_out_at, duration_minutes, gross_minutes, status, is_manual
       FROM time_entries WHERE id = $1`,
      [entryId],
    );
    const entry = rows[0]!;
    expect(entry.duration_minutes).toBe(540); // 09:00 → 18:00
    expect(entry.gross_minutes).toBe(540);
    expect(entry.is_manual).toBe(true);
    // Must stay 'completed' or it drops out of timesheets and payroll.
    expect(entry.status).toBe('completed');
  });

  it('preserves the original punch in the immutable event log', async () => {
    const events = await queryAsSystem<{ event_type: string; event_data: Record<string, unknown> }>(
      `SELECT event_type, event_data FROM time_entry_events
       WHERE time_entry_id = $1 ORDER BY recorded_at`,
      [entryId],
    );

    const edit = events.find((e) => e.event_type === 'entry_edited');
    expect(edit).toBeDefined();
    const before = edit!.event_data.before as { punchOutAt: string };
    const after = edit!.event_data.after as { punchOutAt: string };
    // The 17:00 the worker actually punched is still recoverable.
    expect(new Date(before.punchOutAt).getUTCHours()).toBe(17);
    expect(new Date(after.punchOutAt).getUTCHours()).toBe(18);
    expect(edit!.event_data.reason).toContain('Stayed an extra hour');
  });

  it('writes an audit row naming the approver', async () => {
    const rows = await queryAsSystem<{ action: string; actor_user_id: string }>(
      `SELECT action, actor_user_id FROM audit_logs
       WHERE resource_id = $1 AND action = 'correction_approved'`,
      [requestId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_user_id).toBe(org.manager.id);
  });

  it('refuses a second decision on the same request', async () => {
    await request(app)
      .post(`/api/v1/admin/corrections/${requestId}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'rejected' })
      .expect(409);
  });
});

describe('approve with modification', () => {
  it('applies the manager override, not the requested time', async () => {
    const entryId = await newEntry(org.employee.id, 11);
    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: daysAgo(11, 21), // asks for 4 extra hours
        reason: 'worked late',
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/admin/corrections/${res.body.data.id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({
        decision: 'approved',
        overridePunchOutAt: daysAgo(11, 18), // manager grants one
        note: 'Gate log shows you left at 18:00.',
      })
      .expect(200);

    const rows = await queryAsSystem<{ duration_minutes: number }>(
      `SELECT duration_minutes FROM time_entries WHERE id = $1`,
      [entryId],
    );
    expect(rows[0]!.duration_minutes).toBe(540); // 9h, not 12h
  });
});

describe('rejection', () => {
  it('leaves the time record untouched', async () => {
    const entryId = await newEntry(org.employee.id, 12);
    const before = await queryAsSystem<{ duration_minutes: number }>(
      `SELECT duration_minutes FROM time_entries WHERE id = $1`,
      [entryId],
    );

    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: daysAgo(12, 23),
        reason: 'try it on',
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/admin/corrections/${res.body.data.id}/decision`)
      .set('Authorization', org.owner.auth)
      .send({ decision: 'rejected', note: 'No record of that.' })
      .expect(200);

    const after = await queryAsSystem<{ duration_minutes: number }>(
      `SELECT duration_minutes FROM time_entries WHERE id = $1`,
      [entryId],
    );
    expect(after[0]!.duration_minutes).toBe(before[0]!.duration_minutes);
  });
});

describe('self-approval', () => {
  it('refuses to let a manager decide their own request', async () => {
    const entryId = await newEntry(org.manager.id, 13);
    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.manager.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: daysAgo(13, 19),
        reason: 'my own shift',
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/admin/corrections/${res.body.data.id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'approved' })
      .expect(403);

    // Another approver can still decide it.
    await request(app)
      .post(`/api/v1/admin/corrections/${res.body.data.id}/decision`)
      .set('Authorization', org.owner.auth)
      .send({ decision: 'approved' })
      .expect(200);
  });
});

describe('adding a missing shift', () => {
  it('creates a payable entry on approval', async () => {
    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'add_entry',
        requestedPunchInAt: daysAgo(14, 8),
        requestedPunchOutAt: daysAgo(14, 12),
        reason: 'Phone was dead, never clocked in.',
      })
      .expect(201);
    expect(res.body.data.minutes_delta).toBe(240);

    const decision = await request(app)
      .post(`/api/v1/admin/corrections/${res.body.data.id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'approved' })
      .expect(200);

    const entryId = decision.body.data.applied_entry_id;
    expect(entryId).toBeTruthy();

    const rows = await queryAsSystem<{
      duration_minutes: number;
      status: string;
      is_manual: boolean;
      user_id: string;
    }>(`SELECT duration_minutes, status, is_manual, user_id FROM time_entries WHERE id = $1`, [
      entryId,
    ]);
    expect(rows[0]!.duration_minutes).toBe(240);
    expect(rows[0]!.status).toBe('completed');
    expect(rows[0]!.is_manual).toBe(true);
    expect(rows[0]!.user_id).toBe(org.employee.id);
  });

  it('refuses a shift that overlaps one already recorded', async () => {
    await newEntry(org.coworker.id, 15); // 09:00 → 17:00

    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.coworker.auth)
      .send({
        requestType: 'add_entry',
        requestedPunchInAt: daysAgo(15, 12),
        requestedPunchOutAt: daysAgo(15, 20),
        reason: 'double count attempt',
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/admin/corrections/${res.body.data.id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'approved' })
      .expect(409);
  });
});

describe('deleting a duplicate', () => {
  it('removes it from payable hours but keeps the row and the event', async () => {
    const entryId = await newEntry(org.employee.id, 16);

    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'delete_entry',
        timeEntryId: entryId,
        reason: 'Clocked in twice by mistake.',
      })
      .expect(201);
    expect(res.body.data.minutes_delta).toBe(-480);

    await request(app)
      .post(`/api/v1/admin/corrections/${res.body.data.id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'approved' })
      .expect(200);

    const rows = await queryAsSystem<{ status: string }>(
      `SELECT status FROM time_entries WHERE id = $1`,
      [entryId],
    );
    expect(rows[0]!.status).toBe('deleted');

    const events = await queryAsSystem<{ event_type: string }>(
      `SELECT event_type FROM time_entry_events WHERE time_entry_id = $1`,
      [entryId],
    );
    expect(events.map((e) => e.event_type)).toContain('entry_deleted');
  });

  it('disappears from the punch list once removed', async () => {
    const entryId = await newEntry(org.employee.id, 19);

    const before = await request(app)
      .get('/api/v1/time-tracking/entries?limit=500')
      .set('Authorization', org.employee.auth)
      .expect(200);
    expect((before.body.data as { id: string }[]).map((e) => e.id)).toContain(entryId);

    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({ requestType: 'delete_entry', timeEntryId: entryId, reason: 'duplicate punch' })
      .expect(201);
    await request(app)
      .post(`/api/v1/admin/corrections/${res.body.data.id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'approved' })
      .expect(200);

    const after = await request(app)
      .get('/api/v1/time-tracking/entries?limit=500')
      .set('Authorization', org.employee.auth)
      .expect(200);
    expect((after.body.data as { id: string }[]).map((e) => e.id)).not.toContain(entryId);
  });

  it('is excluded from the timesheet after deletion', async () => {
    const day = daysAgo(17, 9).slice(0, 10);
    const entryId = await newEntry(org.coworker.id, 17);

    const before = await request(app)
      .get(`/api/v1/me/timesheet?from=${day}&to=${day}`)
      .set('Authorization', org.coworker.auth)
      .expect(200);
    expect(before.body.data.totalHours).toBeGreaterThan(0);

    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.coworker.auth)
      .send({ requestType: 'delete_entry', timeEntryId: entryId, reason: 'duplicate' })
      .expect(201);
    await request(app)
      .post(`/api/v1/admin/corrections/${res.body.data.id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'approved' })
      .expect(200);

    const after = await request(app)
      .get(`/api/v1/me/timesheet?from=${day}&to=${day}`)
      .set('Authorization', org.coworker.auth)
      .expect(200);
    expect(after.body.data.totalHours).toBe(0);
  });
});

describe('withdrawing a request', () => {
  it('lets the requester cancel while pending, and nobody else', async () => {
    const entryId = await newEntry(org.employee.id, 18);
    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: daysAgo(18, 18),
        reason: 'mistake',
      })
      .expect(201);
    const id = res.body.data.id;

    await request(app)
      .post(`/api/v1/me/corrections/${id}/cancel`)
      .set('Authorization', org.coworker.auth)
      .expect(403);

    await request(app)
      .post(`/api/v1/me/corrections/${id}/cancel`)
      .set('Authorization', org.employee.auth)
      .expect(200);

    // A cancelled request can no longer be decided.
    await request(app)
      .post(`/api/v1/admin/corrections/${id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'approved' })
      .expect(409);
  });
});

describe('my requests list', () => {
  it('returns only my own', async () => {
    const res = await request(app)
      .get('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .expect(200);

    const rows = res.body.data as { user_id: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.user_id).toBe(org.employee.id);
  });
});
