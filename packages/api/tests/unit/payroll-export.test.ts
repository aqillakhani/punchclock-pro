import { describe, it, expect } from '@jest/globals';
import {
  buildIIF,
  buildQboJson,
  computeW2Breakdown,
  resolveAccounts,
  type PayrollWorker,
} from '../../src/services/payroll-export.service.js';

const ACCOUNTS = resolveAccounts(null);
const PERIOD = { fromDate: '2026-06-01', toDate: '2026-06-14' };

const ALEX_W2: PayrollWorker = {
  userId: 'u-alex',
  name: 'Alex Rivera',
  workerType: 'W2',
  payCurrency: 'USD',
  payRate: 17,
  regularHours: 80,
  overtimeHours: 0,
  doubleTimeHours: 0,
  totalHours: 80,
  grossPay: 1360, // 80h × $17
};

const MAYA_1099: PayrollWorker = {
  userId: 'u-maya',
  name: 'Maya Singh',
  workerType: 'contractor_1099',
  payCurrency: 'INR',
  payRate: 16,
  regularHours: 60,
  overtimeHours: 0,
  doubleTimeHours: 0,
  totalHours: 60,
  grossPay: 960,
};

describe('computeW2Breakdown()', () => {
  it('produces a balanced journal entry on round numbers', () => {
    const b = computeW2Breakdown(1000);
    expect(b.federalWithholding).toBe(100);
    expect(b.stateWithholding).toBe(50);
    expect(b.ficaEmployee).toBe(76.5);
    expect(b.ficaEmployer).toBe(76.5);
    expect(b.netPay).toBe(773.5);
    // Debits = gross + ficaEmployer; credits = net + federal + state + (ficaEmployee + ficaEmployer)
    const debits = b.gross + b.ficaEmployer;
    const credits =
      b.netPay + b.federalWithholding + b.stateWithholding + b.ficaEmployee + b.ficaEmployer;
    expect(debits).toBeCloseTo(credits, 2);
  });

  it('rounds to two decimals', () => {
    const b = computeW2Breakdown(1234.56);
    expect(Number.isInteger(b.federalWithholding * 100)).toBe(true);
    expect(Number.isInteger(b.netPay * 100)).toBe(true);
  });

  it('returns zero across the board for a zero gross', () => {
    const b = computeW2Breakdown(0);
    expect(b.gross).toBe(0);
    expect(b.netPay).toBe(0);
    expect(b.ficaEmployer).toBe(0);
  });
});

describe('buildIIF()', () => {
  it('emits header rows + a balanced W-2 entry + a 1099 entry', () => {
    const iif = buildIIF({ workers: [ALEX_W2, MAYA_1099], period: PERIOD, accounts: ACCOUNTS });
    const lines = iif.trim().split('\n');

    // Headers
    expect(lines[0]).toMatch(/^!TRNS\t/);
    expect(lines[1]).toMatch(/^!SPL\t/);
    expect(lines[2]).toBe('!ENDTRNS');

    // Two ENDTRNS lines for two transactions.
    const endTrnsCount = lines.filter((l) => l === 'ENDTRNS').length;
    expect(endTrnsCount).toBe(2);

    // Each TRNS / SPL line is tab-delimited.
    const dataLines = lines.filter((l) => l.startsWith('TRNS\t') || l.startsWith('SPL\t'));
    for (const l of dataLines) expect(l.split('\t').length).toBeGreaterThan(8);
  });

  it('produces balanced amounts per W-2 entry (debits = credits)', () => {
    const iif = buildIIF({ workers: [ALEX_W2], period: PERIOD, accounts: ACCOUNTS });
    const dataLines = iif
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('TRNS\t') || l.startsWith('SPL\t'));
    const sum = dataLines.reduce((acc, l) => {
      const fields = l.split('\t');
      return acc + Number(fields[6]); // AMOUNT column
    }, 0);
    expect(Math.abs(sum)).toBeLessThan(0.01);
  });

  it('1099 contractor entry has exactly one TRNS + one SPL summing to zero', () => {
    const iif = buildIIF({ workers: [MAYA_1099], period: PERIOD, accounts: ACCOUNTS });
    const dataLines = iif
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('TRNS\t') || l.startsWith('SPL\t'));
    expect(dataLines.length).toBe(2);
    const sum = dataLines.reduce((acc, l) => acc + Number(l.split('\t')[6]), 0);
    expect(Math.abs(sum)).toBeLessThan(0.01);
  });

  it('uses the contractor expense + AP accounts for 1099 workers', () => {
    const iif = buildIIF({ workers: [MAYA_1099], period: PERIOD, accounts: ACCOUNTS });
    expect(iif).toContain('Contractor Expense');
    expect(iif).toContain('Accounts Payable');
    // Should NOT contain W-2-only accounts.
    expect(iif).not.toContain('Wages Payable');
    expect(iif).not.toContain('FICA Payable');
  });

  it('respects custom account names', () => {
    const customAccounts = resolveAccounts({ laborExpense: '5100 · Wages — Hourly' });
    const iif = buildIIF({ workers: [ALEX_W2], period: PERIOD, accounts: customAccounts });
    expect(iif).toContain('5100 · Wages — Hourly');
    expect(iif).not.toContain('Labor Expense\t');
  });

  it('skips workers with zero gross pay', () => {
    const zeroWorker: PayrollWorker = { ...ALEX_W2, grossPay: 0 };
    const iif = buildIIF({ workers: [zeroWorker], period: PERIOD, accounts: ACCOUNTS });
    const dataLines = iif
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('TRNS\t') || l.startsWith('SPL\t'));
    expect(dataLines.length).toBe(0);
  });

  it('formats the DATE column as MM/DD/YYYY (QB Desktop expectation)', () => {
    const iif = buildIIF({ workers: [ALEX_W2], period: PERIOD, accounts: ACCOUNTS });
    const dataLines = iif
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('TRNS\t') || l.startsWith('SPL\t'));
    for (const l of dataLines) {
      const fields = l.split('\t');
      expect(fields[3]).toBe('06/14/2026');
    }
  });
});

describe('buildQboJson()', () => {
  it('produces one JournalEntry per worker with a doc-numbered prefix', () => {
    const json = buildQboJson({
      workers: [ALEX_W2, MAYA_1099],
      period: PERIOD,
      accounts: ACCOUNTS,
    });
    expect(json.entries).toHaveLength(2);
    expect(json.entries[0]?.DocNumber).toMatch(/^PR20260601-001$/);
    expect(json.entries[1]?.DocNumber).toMatch(/^PR20260601-002$/);
    expect(json.entries[0]?.TxnDate).toBe('2026-06-14');
  });

  it('balances per-entry: sum(debits) === sum(credits)', () => {
    const json = buildQboJson({ workers: [ALEX_W2], period: PERIOD, accounts: ACCOUNTS });
    const lines = json.entries[0]!.Line;
    const debits = lines
      .filter((l) => l.JournalEntryLineDetail.PostingType === 'Debit')
      .reduce((s, l) => s + l.Amount, 0);
    const credits = lines
      .filter((l) => l.JournalEntryLineDetail.PostingType === 'Credit')
      .reduce((s, l) => s + l.Amount, 0);
    expect(debits).toBeCloseTo(credits, 2);
  });

  it('1099 entry has exactly two lines (debit + credit)', () => {
    const json = buildQboJson({ workers: [MAYA_1099], period: PERIOD, accounts: ACCOUNTS });
    expect(json.entries[0]!.Line).toHaveLength(2);
    expect(json.entries[0]!.Line[0]?.JournalEntryLineDetail.PostingType).toBe('Debit');
    expect(json.entries[0]!.Line[1]?.JournalEntryLineDetail.PostingType).toBe('Credit');
  });

  it('skips zero-pay workers', () => {
    const json = buildQboJson({
      workers: [{ ...ALEX_W2, grossPay: 0 }],
      period: PERIOD,
      accounts: ACCOUNTS,
    });
    expect(json.entries).toHaveLength(0);
  });
});
