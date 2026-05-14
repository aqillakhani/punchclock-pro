/**
 * Payroll export — design §3e + §6.
 *
 * Two outputs share the same intermediate representation:
 *
 *   - IIF (QuickBooks Desktop) — tab-delimited text, per Intuit's
 *     legacy import format. Imported via File → Utilities → Import → IIF.
 *   - QBO JSON (QuickBooks Online) — array of JournalEntry payloads
 *     matching the QBO REST API shape.
 *
 * W-2 employees get a full journal entry (gross wages → labor expense
 * + employer payroll tax expense; offset by net pay payable + tax
 * withholding payables). 1099 contractors get a single contractor
 * expense → accounts payable pair, since FLSA / employer-side
 * withholding doesn't apply.
 *
 * Tax rates are deliberately conservative defaults — real payroll
 * uses lookup tables that vary by W-4 / state / pay frequency. We
 * keep them as constants so the produced entries balance to zero;
 * the owner runs the exact reconciliation in QuickBooks.
 */
import type { PoolClient } from 'pg';
import { calculateOvertime, type OvertimeJurisdiction } from './overtime.service.js';

// Conservative rough rates — see file-level comment.
const FEDERAL_TAX_RATE = 0.1;
const STATE_TAX_RATE = 0.05;
const FICA_RATE = 0.0765; // employee side; employer match is the same number

const DEFAULT_ACCOUNTS = {
  laborExpense: 'Labor Expense',
  payrollTaxExpense: 'Payroll Tax Expense',
  wagesPayable: 'Wages Payable',
  federalTaxPayable: 'Federal Tax Payable',
  stateTaxPayable: 'State Tax Payable',
  ficaPayable: 'FICA Payable',
  contractorExpense: 'Contractor Expense',
  accountsPayable: 'Accounts Payable',
} as const;

export type AccountMap = typeof DEFAULT_ACCOUNTS;

export function resolveAccounts(custom: Partial<AccountMap> | null | undefined): AccountMap {
  return { ...DEFAULT_ACCOUNTS, ...(custom ?? {}) };
}

// ---- Domain types --------------------------------------------------

export interface PayrollWorker {
  userId: string;
  name: string; // "First Last" or email fallback
  workerType: 'W2' | 'contractor_1099';
  payCurrency: string;
  payRate: number;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  totalHours: number;
  grossPay: number;
}

export interface W2Breakdown {
  gross: number;
  federalWithholding: number;
  stateWithholding: number;
  ficaEmployee: number;
  ficaEmployer: number;
  netPay: number;
  totalCredits: number; // gross + ficaEmployer (debits) balance against credits
}

export interface PayrollPeriod {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
}

// ---- Pure money math ----------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeW2Breakdown(gross: number): W2Breakdown {
  const g = round2(gross);
  const federal = round2(g * FEDERAL_TAX_RATE);
  const state = round2(g * STATE_TAX_RATE);
  const ficaEmployee = round2(g * FICA_RATE);
  const ficaEmployer = round2(g * FICA_RATE);
  const net = round2(g - federal - state - ficaEmployee);
  return {
    gross: g,
    federalWithholding: federal,
    stateWithholding: state,
    ficaEmployee,
    ficaEmployer,
    netPay: net,
    totalCredits: round2(net + federal + state + ficaEmployee + ficaEmployer),
  };
}

// ---- IIF formatting -----------------------------------------------

function fmtIIFDate(yyyyMmDd: string): string {
  // QuickBooks Desktop IIF wants MM/DD/YYYY.
  const [y, m, d] = yyyyMmDd.split('-');
  return `${m}/${d}/${y}`;
}

function fmtMoney(n: number): string {
  return n.toFixed(2);
}

function iifEscape(s: string): string {
  // IIF is tab-delimited; tabs and newlines in fields will break the
  // import. Strip them; QB itself doesn't accept embedded controls.
  return s.replace(/[\t\n\r]+/g, ' ').trim();
}

function iifLine(...fields: string[]): string {
  return fields.join('\t');
}

const IIF_HEADER_TRNS = '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR';
const IIF_HEADER_SPL = '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR';
const IIF_HEADER_ENDTRNS = '!ENDTRNS';

export function buildIIF(args: {
  workers: PayrollWorker[];
  period: PayrollPeriod;
  accounts: AccountMap;
}): string {
  const { workers, period, accounts } = args;
  const lines: string[] = [IIF_HEADER_TRNS, IIF_HEADER_SPL, IIF_HEADER_ENDTRNS];
  const date = fmtIIFDate(period.toDate);
  const docNum = `PR${period.fromDate.replace(/-/g, '')}`;
  let trnsId = 1;

  for (const w of workers) {
    if (w.grossPay <= 0) continue;
    const memo = `Payroll ${period.fromDate} to ${period.toDate}`;
    const name = iifEscape(w.name);

    if (w.workerType === 'W2') {
      const b = computeW2Breakdown(w.grossPay);
      // TRNS = primary debit; SPL = the balancing entries (negative = credit)
      lines.push(
        iifLine(
          'TRNS',
          String(trnsId++),
          'GENERAL JOURNAL',
          date,
          iifEscape(accounts.laborExpense),
          name,
          fmtMoney(b.gross),
          docNum,
          iifEscape(memo),
          'N',
        ),
        iifLine(
          'SPL',
          String(trnsId++),
          'GENERAL JOURNAL',
          date,
          iifEscape(accounts.payrollTaxExpense),
          name,
          fmtMoney(b.ficaEmployer),
          docNum,
          iifEscape('Employer FICA / Medicare match'),
          'N',
        ),
        iifLine(
          'SPL',
          String(trnsId++),
          'GENERAL JOURNAL',
          date,
          iifEscape(accounts.wagesPayable),
          name,
          fmtMoney(-b.netPay),
          docNum,
          iifEscape('Net pay'),
          'N',
        ),
        iifLine(
          'SPL',
          String(trnsId++),
          'GENERAL JOURNAL',
          date,
          iifEscape(accounts.federalTaxPayable),
          name,
          fmtMoney(-b.federalWithholding),
          docNum,
          iifEscape('Federal income tax withholding'),
          'N',
        ),
        iifLine(
          'SPL',
          String(trnsId++),
          'GENERAL JOURNAL',
          date,
          iifEscape(accounts.stateTaxPayable),
          name,
          fmtMoney(-b.stateWithholding),
          docNum,
          iifEscape('State income tax withholding'),
          'N',
        ),
        iifLine(
          'SPL',
          String(trnsId++),
          'GENERAL JOURNAL',
          date,
          iifEscape(accounts.ficaPayable),
          name,
          fmtMoney(-(b.ficaEmployee + b.ficaEmployer)),
          docNum,
          iifEscape('FICA / Medicare payable (employee + employer)'),
          'N',
        ),
        'ENDTRNS',
      );
    } else {
      // 1099 contractor — single DR/CR pair.
      lines.push(
        iifLine(
          'TRNS',
          String(trnsId++),
          'GENERAL JOURNAL',
          date,
          iifEscape(accounts.contractorExpense),
          name,
          fmtMoney(w.grossPay),
          docNum,
          iifEscape(memo),
          'N',
        ),
        iifLine(
          'SPL',
          String(trnsId++),
          'GENERAL JOURNAL',
          date,
          iifEscape(accounts.accountsPayable),
          name,
          fmtMoney(-w.grossPay),
          docNum,
          iifEscape('Contractor payable'),
          'N',
        ),
        'ENDTRNS',
      );
    }
  }

  return lines.join('\n') + '\n';
}

// ---- QBO JSON formatting ------------------------------------------

export interface QboLine {
  Description: string;
  Amount: number;
  DetailType: 'JournalEntryLineDetail';
  JournalEntryLineDetail: {
    PostingType: 'Debit' | 'Credit';
    AccountRef: { name: string };
  };
}

export interface QboJournalEntry {
  DocNumber: string;
  TxnDate: string;
  PrivateNote: string;
  Line: QboLine[];
}

function qboLine(
  account: string,
  amount: number,
  postingType: 'Debit' | 'Credit',
  desc: string,
): QboLine {
  return {
    Description: desc,
    Amount: round2(amount),
    DetailType: 'JournalEntryLineDetail',
    JournalEntryLineDetail: {
      PostingType: postingType,
      AccountRef: { name: account },
    },
  };
}

export function buildQboJson(args: {
  workers: PayrollWorker[];
  period: PayrollPeriod;
  accounts: AccountMap;
}): { period: PayrollPeriod; entries: QboJournalEntry[] } {
  const { workers, period, accounts } = args;
  const entries: QboJournalEntry[] = [];
  const docPrefix = `PR${period.fromDate.replace(/-/g, '')}`;

  let docNum = 1;
  for (const w of workers) {
    if (w.grossPay <= 0) continue;
    const memo = `Payroll ${period.fromDate} → ${period.toDate} for ${w.name}`;
    if (w.workerType === 'W2') {
      const b = computeW2Breakdown(w.grossPay);
      entries.push({
        DocNumber: `${docPrefix}-${String(docNum++).padStart(3, '0')}`,
        TxnDate: period.toDate,
        PrivateNote: memo,
        Line: [
          qboLine(accounts.laborExpense, b.gross, 'Debit', `${w.name} — gross wages`),
          qboLine(accounts.payrollTaxExpense, b.ficaEmployer, 'Debit', `${w.name} — employer FICA`),
          qboLine(accounts.wagesPayable, b.netPay, 'Credit', `${w.name} — net pay`),
          qboLine(
            accounts.federalTaxPayable,
            b.federalWithholding,
            'Credit',
            `${w.name} — federal withholding`,
          ),
          qboLine(
            accounts.stateTaxPayable,
            b.stateWithholding,
            'Credit',
            `${w.name} — state withholding`,
          ),
          qboLine(
            accounts.ficaPayable,
            b.ficaEmployee + b.ficaEmployer,
            'Credit',
            `${w.name} — FICA payable`,
          ),
        ],
      });
    } else {
      entries.push({
        DocNumber: `${docPrefix}-${String(docNum++).padStart(3, '0')}`,
        TxnDate: period.toDate,
        PrivateNote: memo,
        Line: [
          qboLine(accounts.contractorExpense, w.grossPay, 'Debit', `${w.name} — contractor pay`),
          qboLine(accounts.accountsPayable, w.grossPay, 'Credit', `${w.name} — payable`),
        ],
      });
    }
  }
  return { period, entries };
}

// ---- DB-side: load worker pay totals for a period -----------------

export async function loadWorkersForPeriod(
  db: PoolClient,
  args: { period: PayrollPeriod; jurisdiction: OvertimeJurisdiction; orgTimezone: string },
): Promise<PayrollWorker[]> {
  const { rows: users } = await db.query<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    worker_type: 'W2' | 'contractor_1099';
    pay_currency: string;
    pay_rate: string | null;
  }>(
    `SELECT id, email, first_name, last_name, worker_type, pay_currency, pay_rate
     FROM users
     WHERE deleted_at IS NULL AND status = 'active' AND COALESCE(pay_rate, 0) > 0
     ORDER BY first_name, last_name`,
  );

  const { rows: dayTotals } = await db.query<{
    user_id: string;
    day: string;
    total_minutes: string;
  }>(
    `SELECT user_id,
            to_char((punch_in_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day,
            SUM(duration_minutes)::text AS total_minutes
     FROM time_entries
     WHERE status = 'completed'
       AND punch_in_at >= ($1::date) AT TIME ZONE $3
       AND punch_in_at <  (($2::date) + INTERVAL '1 day') AT TIME ZONE $3
     GROUP BY user_id, day`,
    [args.period.fromDate, args.period.toDate, args.orgTimezone],
  );

  const hoursByUserDay = new Map<string, Map<string, number>>();
  for (const r of dayTotals) {
    const m = hoursByUserDay.get(r.user_id) ?? new Map<string, number>();
    m.set(r.day, Number(r.total_minutes ?? 0) / 60);
    hoursByUserDay.set(r.user_id, m);
  }

  const dayList = enumerateDays(args.period.fromDate, args.period.toDate);

  return users.map((u) => {
    const dayMap = hoursByUserDay.get(u.id) ?? new Map<string, number>();
    const days = dayList.map((d) => ({ date: d, hours: dayMap.get(d) ?? 0 }));
    const weeks = splitIntoWeeks(days);
    const ot = weeks.reduce(
      (acc, week) => {
        const w = calculateOvertime(week, args.jurisdiction);
        acc.regular += w.regularHours;
        acc.overtime += w.overtimeHours;
        acc.doubleTime += w.doubleTimeHours;
        return acc;
      },
      { regular: 0, overtime: 0, doubleTime: 0 },
    );
    const rate = u.pay_rate ? Number(u.pay_rate) : 0;
    const grossPay =
      u.worker_type === 'contractor_1099'
        ? round2(days.reduce((s, d) => s + d.hours, 0) * rate) // straight-time for 1099
        : round2(ot.regular * rate + ot.overtime * rate * 1.5 + ot.doubleTime * rate * 2);
    return {
      userId: u.id,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email,
      workerType: u.worker_type,
      payCurrency: u.pay_currency,
      payRate: rate,
      regularHours:
        u.worker_type === 'contractor_1099' ? days.reduce((s, d) => s + d.hours, 0) : ot.regular,
      overtimeHours: u.worker_type === 'contractor_1099' ? 0 : ot.overtime,
      doubleTimeHours: u.worker_type === 'contractor_1099' ? 0 : ot.doubleTime,
      totalHours: days.reduce((s, d) => s + d.hours, 0),
      grossPay,
    };
  });
}

function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function splitIntoWeeks(
  days: { date: string; hours: number }[],
): { date: string; hours: number }[][] {
  if (days.length === 0) return [];
  const weeks: { date: string; hours: number }[][] = [];
  let current: { date: string; hours: number }[] = [];
  for (const d of days) {
    if (current.length > 0 && new Date(`${d.date}T00:00:00Z`).getUTCDay() === 1) {
      weeks.push(current);
      current = [];
    }
    current.push(d);
  }
  if (current.length > 0) weeks.push(current);
  return weeks;
}
