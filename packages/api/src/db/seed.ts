import '../config/load-env.js';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcrypt';
import { getPool, closePool } from '../config/database.js';
import { loadEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

const STORE = {
  name: 'Quick Stop #4',
  address: '4521 Westheimer Rd, Houston, TX 77027',
  latitude: 29.7407,
  longitude: -95.4654,
  radiusMeters: 120,
  timezone: 'America/Chicago',
};

const DEFAULT_PASSWORD = 'Demo12345';

type WorkerType = 'W2' | 'contractor_1099';
type Worksite = 'onshore' | 'offshore';

interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  role: 'owner' | 'manager' | 'employee';
  payRate: number;
  category: 'in_store' | 'remote';
  jobTitle: string;
  workerType?: WorkerType;
  worksite?: Worksite;
  payCurrency?: string;
}

const USERS: SeedUser[] = [
  {
    email: 'owner@quickstop.test',
    firstName: 'Demo',
    lastName: 'Owner',
    role: 'owner',
    payRate: 0,
    category: 'in_store',
    jobTitle: 'Owner',
  },
  {
    email: 'jordan.kim@quickstop.test',
    firstName: 'Jordan',
    lastName: 'Kim',
    role: 'manager',
    payRate: 26,
    category: 'in_store',
    jobTitle: 'Store Manager',
  },
  {
    email: 'priya.sharma@quickstop.test',
    firstName: 'Priya',
    lastName: 'Sharma',
    role: 'manager',
    payRate: 22,
    category: 'in_store',
    jobTitle: 'Asst Store Manager',
  },
  {
    email: 'alex.rivera@quickstop.test',
    firstName: 'Alex',
    lastName: 'Rivera',
    role: 'employee',
    payRate: 17,
    category: 'in_store',
    jobTitle: 'Shift Lead',
  },
  {
    email: 'mei.chen@quickstop.test',
    firstName: 'Mei',
    lastName: 'Chen',
    role: 'employee',
    payRate: 17,
    category: 'in_store',
    jobTitle: 'Shift Lead',
  },
  {
    email: 'omar.hassan@quickstop.test',
    firstName: 'Omar',
    lastName: 'Hassan',
    role: 'employee',
    payRate: 13.5,
    category: 'in_store',
    jobTitle: 'Cashier',
  },
  {
    email: 'sofia.delgado@quickstop.test',
    firstName: 'Sofia',
    lastName: 'Delgado',
    role: 'employee',
    payRate: 13.5,
    category: 'in_store',
    jobTitle: 'Cashier',
  },
  {
    email: 'marcus.chen@quickstop.test',
    firstName: 'Marcus',
    lastName: 'Chen',
    role: 'employee',
    payRate: 13,
    category: 'in_store',
    jobTitle: 'Cashier',
  },
  {
    email: 'aaliyah.brooks@quickstop.test',
    firstName: 'Aaliyah',
    lastName: 'Brooks',
    role: 'employee',
    payRate: 13,
    category: 'in_store',
    jobTitle: 'Cashier',
  },
  {
    email: 'diego.alvarez@quickstop.test',
    firstName: 'Diego',
    lastName: 'Alvarez',
    role: 'employee',
    payRate: 13,
    category: 'in_store',
    jobTitle: 'Cashier',
  },
  {
    email: 'jamal.thompson@quickstop.test',
    firstName: 'Jamal',
    lastName: 'Thompson',
    role: 'employee',
    payRate: 13,
    category: 'in_store',
    jobTitle: 'Cashier',
  },
  {
    email: 'noor.patel@quickstop.test',
    firstName: 'Noor',
    lastName: 'Patel',
    role: 'employee',
    payRate: 14,
    category: 'in_store',
    jobTitle: 'Cashier (PT)',
  },
  {
    email: 'eli.fisher@quickstop.test',
    firstName: 'Eli',
    lastName: 'Fisher',
    role: 'employee',
    payRate: 14,
    category: 'in_store',
    jobTitle: 'Cashier (PT)',
  },
  {
    email: 'lina.park@quickstop.test',
    firstName: 'Lina',
    lastName: 'Park',
    role: 'employee',
    payRate: 14,
    category: 'in_store',
    jobTitle: 'Cashier (PT)',
  },
  {
    email: 'devon.wright@quickstop.test',
    firstName: 'Devon',
    lastName: 'Wright',
    role: 'employee',
    payRate: 14.5,
    category: 'in_store',
    jobTitle: 'Stocker',
  },
  {
    email: 'ravi.iyer@quickstop.test',
    firstName: 'Ravi',
    lastName: 'Iyer',
    role: 'employee',
    payRate: 14.5,
    category: 'in_store',
    jobTitle: 'Stocker',
  },
  {
    email: 'kara.lopez@quickstop.test',
    firstName: 'Kara',
    lastName: 'Lopez',
    role: 'employee',
    payRate: 14.5,
    category: 'in_store',
    jobTitle: 'Stocker (overnight)',
  },
  {
    email: 'henry.osei@quickstop.test',
    firstName: 'Henry',
    lastName: 'Osei',
    role: 'employee',
    payRate: 14.5,
    category: 'in_store',
    jobTitle: 'Stocker (overnight)',
  },
  {
    email: 'rosa.martinez@quickstop.test',
    firstName: 'Rosa',
    lastName: 'Martinez',
    role: 'employee',
    payRate: 24,
    category: 'remote',
    jobTitle: 'Bookkeeper (remote)',
  },
  {
    email: 'thomas.nguyen@quickstop.test',
    firstName: 'Thomas',
    lastName: 'Nguyen',
    role: 'employee',
    payRate: 21,
    category: 'remote',
    jobTitle: 'Bookkeeper (remote)',
  },
  {
    email: 'maya.singh@quickstop.test',
    firstName: 'Maya',
    lastName: 'Singh',
    role: 'employee',
    payRate: 16,
    category: 'remote',
    jobTitle: 'Online Orders (remote)',
    workerType: 'contractor_1099',
    payCurrency: 'INR',
  },
  {
    email: 'isaac.cole@quickstop.test',
    firstName: 'Isaac',
    lastName: 'Cole',
    role: 'employee',
    payRate: 16,
    category: 'remote',
    jobTitle: 'Online Orders (remote)',
    workerType: 'contractor_1099',
    payCurrency: 'PHP',
  },
  {
    email: 'amani.davis@quickstop.test',
    firstName: 'Amani',
    lastName: 'Davis',
    role: 'employee',
    payRate: 16,
    category: 'remote',
    jobTitle: 'Online Orders (remote)',
    workerType: 'contractor_1099',
    payCurrency: 'PHP',
  },
  {
    email: 'leo.bauer@quickstop.test',
    firstName: 'Leo',
    lastName: 'Bauer',
    role: 'employee',
    payRate: 18,
    category: 'remote',
    jobTitle: 'Customer Support (remote)',
  },
  {
    email: 'aisha.khan@quickstop.test',
    firstName: 'Aisha',
    lastName: 'Khan',
    role: 'employee',
    payRate: 18,
    category: 'remote',
    jobTitle: 'Customer Support (remote)',
  },
];

async function seed(): Promise<void> {
  const env = loadEnv();
  const pool = getPool();
  const client = await pool.connect();
  try {
    logger.info({ store: STORE.name }, 'starting seed');

    await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
    await client.query('BEGIN');

    await client.query(`TRUNCATE organizations CASCADE`);

    const slug = `quick-stop-4-${Date.now()}`;
    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations
         (name, slug, timezone, geofencing_enabled, break_tracking_enabled,
          weekly_labor_budget,
          qb_chart_of_accounts)
       VALUES ($1, $2, $3, TRUE, TRUE,
               6500.00,
               '{"laborExpense":"5100 · Labor Expense","contractorExpense":"5200 · Contractor Expense"}'::jsonb)
       RETURNING id`,
      [STORE.name, slug, STORE.timezone],
    );
    const orgId = orgRes.rows[0]!.id;
    logger.info({ orgId }, 'inserted organization');

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, env.BCRYPT_ROUNDS);

    const userIds = new Map<
      string,
      { id: string; category: SeedUser['category']; payRate: number; role: SeedUser['role'] }
    >();
    for (const u of USERS) {
      // Per design §3b, the in-store/remote distinction defaults to
      // onshore W-2 vs offshore W-2; specific 1099 contractors and
      // non-USD payouts override per-row in the USERS array above.
      const worksite: Worksite = u.worksite ?? (u.category === 'remote' ? 'offshore' : 'onshore');
      const workerType: WorkerType = u.workerType ?? 'W2';
      const payCurrency = u.payCurrency ?? 'USD';
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users
           (organization_id, email, first_name, last_name, password_hash,
            role, pay_rate, status, worker_type, worksite, job_title, pay_currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $11)
         RETURNING id`,
        [
          orgId,
          u.email,
          u.firstName,
          u.lastName,
          passwordHash,
          u.role,
          u.payRate,
          workerType,
          worksite,
          u.jobTitle,
          payCurrency,
        ],
      );
      userIds.set(u.email, {
        id: rows[0]!.id,
        category: u.category,
        payRate: u.payRate,
        role: u.role,
      });
    }
    logger.info({ count: USERS.length }, 'inserted users');

    await client.query(
      `INSERT INTO geofences (organization_id, name, latitude, longitude, radius_meters, enforcement_level, is_active)
       VALUES ($1, $2, $3, $4, $5, 'flag', TRUE)`,
      [orgId, STORE.name, STORE.latitude, STORE.longitude, STORE.radiusMeters],
    );
    logger.info('inserted geofence');

    const now = new Date();
    const todayLocal = atLocalMidnight(now, STORE.timezone);

    // 2 weeks of completed punches for active in-store employees + a few remote.
    const historyEmployees = USERS.filter((u) => u.role !== 'owner');
    let entryCount = 0;
    for (let dayOffset = 14; dayOffset >= 1; dayOffset -= 1) {
      const day = addDays(todayLocal, -dayOffset);
      const dow = day.getDay();
      for (const u of historyEmployees) {
        const info = userIds.get(u.email)!;
        if (!shouldWork(u, dow, dayOffset)) continue;
        const shift = chooseShift(u, dow);
        const punchIn = atTime(day, shift.startHour, shift.startMinute);
        const punchOut = atTime(
          shift.wraps ? addDays(day, 1) : day,
          shift.endHour,
          shift.endMinute,
        );
        const minutes = Math.round((punchOut.getTime() - punchIn.getTime()) / 60000);
        const loc =
          u.category === 'in_store' ? jitterLoc(STORE.latitude, STORE.longitude, 30) : null;
        await insertTimeEntry(client, {
          orgId,
          userId: info.id,
          punchInAt: punchIn,
          punchOutAt: punchOut,
          punchInLat: loc?.lat ?? null,
          punchInLon: loc?.lon ?? null,
          punchOutLat: loc?.lat ?? null,
          punchOutLon: loc?.lon ?? null,
          durationMinutes: minutes,
          status: 'completed',
        });
        entryCount += 1;
      }
    }
    logger.info({ count: entryCount }, 'inserted completed time entries');

    // Current week schedule — assign shifts to in-store employees only.
    const inStoreEmployees = USERS.filter((u) => u.category === 'in_store' && u.role !== 'owner');
    const weekStart = startOfWeekMon(todayLocal);
    let shiftCount = 0;
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(weekStart, i);
      const dayIso = isoDate(day);
      const dow = day.getDay();
      for (const u of inStoreEmployees) {
        if (!shouldWork(u, dow, 0)) continue;
        const shift = chooseShift(u, dow);
        const startStr = `${pad(shift.startHour)}:${pad(shift.startMinute)}`;
        const endStr = `${pad(shift.endHour)}:${pad(shift.endMinute)}`;
        const duration = minutesBetween(startStr, endStr);
        await client.query(
          `INSERT INTO shifts (organization_id, user_id, scheduled_date, shift_start, shift_end, duration_minutes, shift_type, required_break_minutes)
           VALUES ($1, $2, $3, $4, $5, $6, 'standard', 30)`,
          [orgId, userIds.get(u.email)!.id, dayIso, startStr, endStr, duration],
        );
        shiftCount += 1;
      }
    }
    logger.info({ count: shiftCount }, 'inserted scheduled shifts');

    // Currently clocked in (3 people)
    const currentlyClockedIn = [
      'omar.hassan@quickstop.test',
      'kara.lopez@quickstop.test',
      'rosa.martinez@quickstop.test',
    ];
    for (const email of currentlyClockedIn) {
      const info = userIds.get(email);
      if (!info) continue;
      const punchInAt = new Date(now.getTime() - randInt(60, 180) * 60_000);
      const loc =
        info.category === 'in_store' ? jitterLoc(STORE.latitude, STORE.longitude, 30) : null;
      await insertTimeEntry(client, {
        orgId,
        userId: info.id,
        punchInAt,
        punchOutAt: null,
        punchInLat: loc?.lat ?? null,
        punchInLon: loc?.lon ?? null,
        punchOutLat: null,
        punchOutLon: null,
        durationMinutes: null,
        status: 'in_progress',
      });
    }
    logger.info({ count: currentlyClockedIn.length }, 'inserted in-progress entries');

    // -- v2 seed data ---------------------------------------------------
    // Two pending time-off requests (one per requester) so Jordan/Priya
    // see a non-empty queue when Phase B's Time off page lands.
    const timeOffSeeds: { email: string; daysFromNow: number; days: number; reason: string }[] = [
      {
        email: 'sofia.delgado@quickstop.test',
        daysFromNow: 9,
        days: 2,
        reason: "Doctor's appointment",
      },
      {
        email: 'diego.alvarez@quickstop.test',
        daysFromNow: 14,
        days: 3,
        reason: 'Family wedding out of state',
      },
    ];
    for (const t of timeOffSeeds) {
      const info = userIds.get(t.email);
      if (!info) continue;
      const start = addDays(todayLocal, t.daysFromNow);
      const end = addDays(start, t.days - 1);
      await client.query(
        `INSERT INTO time_off_requests
           (organization_id, user_id, start_date, end_date, reason, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [orgId, info.id, isoDate(start), isoDate(end), t.reason],
      );
    }
    logger.info({ count: timeOffSeeds.length }, 'inserted pending time-off requests');

    // One open shift trade: Mei posts an upcoming Saturday shift.
    const meiInfo = userIds.get('mei.chen@quickstop.test');
    if (meiInfo) {
      const { rows: meiShift } = await client.query<{ id: string }>(
        `SELECT id FROM shifts
         WHERE user_id = $1 AND scheduled_date >= CURRENT_DATE
         ORDER BY scheduled_date ASC
         LIMIT 1`,
        [meiInfo.id],
      );
      if (meiShift[0]) {
        await client.query(
          `INSERT INTO shift_trades
             (organization_id, shift_id, from_user_id, status)
           VALUES ($1, $2, $3, 'open')`,
          [orgId, meiShift[0].id, meiInfo.id],
        );
        logger.info({ shiftId: meiShift[0].id }, 'inserted open shift trade');
      }
    }

    // One historical cap-block in the audit log (3 days ago) so the
    // Phase D audit-log viewer has something interesting to show.
    const overworkerInfo = userIds.get('kara.lopez@quickstop.test');
    if (overworkerInfo) {
      const blockedAt = new Date(now.getTime() - 3 * 24 * 60 * 60_000);
      await client.query(
        `INSERT INTO audit_logs
           (organization_id, actor_user_id, resource_type, action, changes, created_at)
         VALUES ($1, $2, 'time_entry', 'cap_blocked', $3::jsonb, $4)`,
        [
          orgId,
          overworkerInfo.id,
          JSON.stringify({ scope: 'daily', cap: 480, current: 480, reason: 'overnight overrun' }),
          blockedAt,
        ],
      );
      logger.info('inserted cap-block audit entry');
    }

    await client.query('COMMIT');
    logger.info('seed complete');
    logger.info(
      {
        store: STORE.name,
        loginUrl: 'http://localhost:3000/login',
        owner: 'owner@quickstop.test',
        password: DEFAULT_PASSWORD,
        managerExample: 'jordan.kim@quickstop.test',
        employeeExample: 'alex.rivera@quickstop.test',
      },
      'demo credentials',
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

interface TimeEntryInsert {
  orgId: string;
  userId: string;
  punchInAt: Date;
  punchOutAt: Date | null;
  punchInLat: number | null;
  punchInLon: number | null;
  punchOutLat: number | null;
  punchOutLon: number | null;
  durationMinutes: number | null;
  status: 'completed' | 'in_progress';
}

async function insertTimeEntry(client: import('pg').PoolClient, e: TimeEntryInsert): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO time_entries
       (organization_id, user_id, punch_in_at, punch_out_at,
        punch_in_latitude, punch_in_longitude, punch_out_latitude, punch_out_longitude,
        duration_minutes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      e.orgId,
      e.userId,
      e.punchInAt,
      e.punchOutAt,
      e.punchInLat,
      e.punchInLon,
      e.punchOutLat,
      e.punchOutLon,
      e.durationMinutes,
      e.status,
    ],
  );
  const entryId = rows[0]!.id;
  await client.query(
    `INSERT INTO time_entry_events
       (organization_id, user_id, time_entry_id, event_type, event_data, actor_user_id, recorded_at)
     VALUES ($1, $2, $3, 'punch_in', $4, $2, $5)`,
    [
      e.orgId,
      e.userId,
      entryId,
      JSON.stringify({ timestamp: e.punchInAt.toISOString() }),
      e.punchInAt,
    ],
  );
  if (e.punchOutAt) {
    await client.query(
      `INSERT INTO time_entry_events
         (organization_id, user_id, time_entry_id, event_type, event_data, actor_user_id, recorded_at)
       VALUES ($1, $2, $3, 'punch_out', $4, $2, $5)`,
      [
        e.orgId,
        e.userId,
        entryId,
        JSON.stringify({ timestamp: e.punchOutAt.toISOString() }),
        e.punchOutAt,
      ],
    );
  }
}

interface Shift {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  wraps: boolean;
}

function chooseShift(u: SeedUser, dow: number): Shift {
  if (u.jobTitle.includes('overnight')) {
    return { startHour: 22, startMinute: 0, endHour: 6, endMinute: 0, wraps: true };
  }
  if (u.role === 'manager') {
    return { startHour: 8, startMinute: 0, endHour: 17, endMinute: 0, wraps: false };
  }
  if (u.category === 'remote') {
    return { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0, wraps: false };
  }
  if (u.jobTitle.includes('Cashier (PT)')) {
    return {
      startHour: dow % 2 === 0 ? 11 : 16,
      startMinute: 0,
      endHour: dow % 2 === 0 ? 16 : 21,
      endMinute: 0,
      wraps: false,
    };
  }
  if (u.jobTitle.includes('Cashier') || u.jobTitle.includes('Shift Lead')) {
    return dow % 2 === 0
      ? { startHour: 7, startMinute: 0, endHour: 15, endMinute: 0, wraps: false }
      : { startHour: 14, startMinute: 0, endHour: 22, endMinute: 0, wraps: false };
  }
  if (u.jobTitle.includes('Stocker')) {
    return { startHour: 6, startMinute: 0, endHour: 14, endMinute: 0, wraps: false };
  }
  return { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0, wraps: false };
}

function shouldWork(u: SeedUser, dow: number, dayOffset: number): boolean {
  // Owner doesn't punch.
  if (u.role === 'owner') return false;
  // Remote workers Mon-Fri only.
  if (u.category === 'remote') return dow >= 1 && dow <= 5;
  // Managers Mon-Fri + every other Saturday.
  if (u.role === 'manager') return dow !== 0 && !(dow === 6 && dayOffset % 14 < 7);
  // Part-time cashiers — 3 days/week.
  if (u.jobTitle.includes('(PT)')) return [1, 3, 5].includes(dow);
  // Overnight stockers — every day except Sunday.
  if (u.jobTitle.includes('overnight')) return dow !== 0;
  // Everyone else — ~5 days per week, pattern varies by name hash.
  const hash = (u.email.charCodeAt(0) + u.email.charCodeAt(1) + dayOffset) % 7;
  return hash < 5;
}

function atLocalMidnight(d: Date, _tz: string): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeekMon(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function atTime(d: Date, hour: number, minute: number): Date {
  const x = new Date(d);
  x.setHours(hour, minute, 0, 0);
  return x;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function jitterLoc(lat: number, lon: number, meters: number): { lat: number; lon: number } {
  const dLat = (Math.random() * 2 - 1) * (meters / 111_320);
  const dLon = (Math.random() * 2 - 1) * (meters / (111_320 * Math.cos((lat * Math.PI) / 180)));
  return { lat: lat + dLat, lon: lon + dLon };
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff <= 0 ? diff + 24 * 60 : diff;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  seed()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'seed failed');
      closePool().finally(() => process.exit(1));
    });
}
