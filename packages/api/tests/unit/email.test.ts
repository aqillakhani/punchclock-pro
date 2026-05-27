import { describe, it, expect } from '@jest/globals';
import {
  passwordResetEmail,
  inviteEmail,
  timeOffDecisionEmail,
  createEmailTransport,
  sendEmail,
  type EmailTransport,
  type EmailMessage,
} from '../../src/services/email.service.js';
import { parseEnv } from '../../src/config/env.js';

describe('email templates', () => {
  it('password reset email carries the reset URL in both text and html', () => {
    const m = passwordResetEmail({
      resetUrl: 'https://app.example.com/reset?token=abc',
      firstName: 'Sam',
    });
    expect(m.subject).toMatch(/reset/i);
    expect(m.text).toContain('https://app.example.com/reset?token=abc');
    expect(m.html).toContain('https://app.example.com/reset?token=abc');
    expect(m.text).toContain('Sam');
  });

  it('invite email carries the setup URL and names the organization', () => {
    const m = inviteEmail({
      setupUrl: 'https://app.example.com/reset?token=xyz',
      orgName: "Bob's Store",
      firstName: 'Lee',
    });
    expect(m.text).toContain('https://app.example.com/reset?token=xyz');
    expect(m.subject).toContain("Bob's Store");
  });

  it('time-off decision email reflects approval vs rejection', () => {
    const approved = timeOffDecisionEmail({
      decision: 'approved',
      startDate: '2026-06-01',
      endDate: '2026-06-03',
    });
    const rejected = timeOffDecisionEmail({
      decision: 'rejected',
      startDate: '2026-06-01',
      endDate: '2026-06-03',
    });
    expect(approved.subject).toMatch(/approved/i);
    expect(rejected.subject).toMatch(/(rejected|declined)/i);
    expect(approved.text).toContain('2026-06-01');
  });
});

describe('createEmailTransport()', () => {
  it('defaults to the log transport when no provider is configured', () => {
    expect(createEmailTransport(parseEnv({ DATABASE_URL: 'postgres://x' })).name).toBe('log');
  });

  it('uses resend when EMAIL_PROVIDER=resend and a key is present', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://x',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test_123',
    });
    expect(createEmailTransport(env).name).toBe('resend');
  });

  it('falls back to log when resend is selected but no key is set', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', EMAIL_PROVIDER: 'resend' });
    expect(createEmailTransport(env).name).toBe('log');
  });
});

describe('sendEmail()', () => {
  it('delegates to the given transport', async () => {
    const sent: EmailMessage[] = [];
    const fake: EmailTransport = {
      name: 'fake',
      send: async (m) => {
        sent.push(m);
      },
    };
    await sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 't' }, fake);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('a@b.com');
  });

  it('never throws even if the transport fails (email is best-effort)', async () => {
    const boom: EmailTransport = {
      name: 'boom',
      send: async () => {
        throw new Error('smtp down');
      },
    };
    await expect(
      sendEmail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' }, boom),
    ).resolves.toBeUndefined();
  });
});
