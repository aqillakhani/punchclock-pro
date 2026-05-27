import { loadEnv, type AppEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Transactional email. Templates are pure functions ({subject, html, text});
 * delivery goes through a swappable transport — Resend in production, a log
 * transport everywhere else (and when no key is configured). `sendEmail` is
 * best-effort: a delivery failure is logged, never thrown, so it can't break
 * the user-facing request that triggered it.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  readonly name: string;
  send(msg: EmailMessage): Promise<void>;
}

// ---- Templates (pure) ------------------------------------------------

const FROM_PRODUCT = 'PunchClock Pro';

function wrapHtml(title: string, bodyLines: string[]): string {
  const paragraphs = bodyLines.map((l) => `<p style="margin:0 0 16px">${l}</p>`).join('');
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">',
    `<h1 style="font-size:18px;margin:0 0 16px">${title}</h1>`,
    paragraphs,
    `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>`,
    `<p style="font-size:12px;color:#64748b;margin:0">${FROM_PRODUCT}</p>`,
    '</div>',
  ].join('');
}

function greeting(firstName?: string): string {
  return firstName ? `Hi ${firstName},` : 'Hi,';
}

export function passwordResetEmail(opts: { resetUrl: string; firstName?: string }): EmailMessage {
  const subject = 'Reset your PunchClock Pro password';
  const text = [
    greeting(opts.firstName),
    '',
    'We received a request to reset your password. Open this link to choose a new one (it expires in 15 minutes):',
    opts.resetUrl,
    '',
    "If you didn't request this, you can safely ignore this email — your password won't change.",
  ].join('\n');
  const html = wrapHtml('Reset your password', [
    greeting(opts.firstName),
    'We received a request to reset your password. The link below expires in 15 minutes.',
    `<a href="${opts.resetUrl}">Choose a new password</a>`,
    `<span style="font-size:12px;color:#64748b">Or paste this URL: ${opts.resetUrl}</span>`,
    "If you didn't request this, you can ignore this email.",
  ]);
  return { to: '', subject, html, text };
}

export function inviteEmail(opts: {
  setupUrl: string;
  orgName: string;
  firstName?: string;
}): EmailMessage {
  const subject = `You've been added to ${opts.orgName} on PunchClock Pro`;
  const text = [
    greeting(opts.firstName),
    '',
    `${opts.orgName} has set up an account for you on PunchClock Pro. Choose your password to get started (link expires in 15 minutes):`,
    opts.setupUrl,
    '',
    'After that you can clock in, view your schedule, and request time off.',
  ].join('\n');
  const html = wrapHtml(`Welcome to ${opts.orgName}`, [
    greeting(opts.firstName),
    `${opts.orgName} has set up an account for you on PunchClock Pro.`,
    `<a href="${opts.setupUrl}">Set your password</a>`,
    `<span style="font-size:12px;color:#64748b">Or paste this URL: ${opts.setupUrl}</span>`,
    'The link expires in 15 minutes.',
  ]);
  return { to: '', subject, html, text };
}

export function timeOffDecisionEmail(opts: {
  decision: 'approved' | 'rejected';
  startDate: string;
  endDate: string;
  firstName?: string;
  comment?: string;
}): EmailMessage {
  const verb = opts.decision === 'approved' ? 'approved' : 'rejected';
  const subject = `Your time-off request was ${verb}`;
  const range = `${opts.startDate} to ${opts.endDate}`;
  const lines = [greeting(opts.firstName), '', `Your time-off request for ${range} was ${verb}.`];
  if (opts.comment) lines.push('', `Note from your manager: ${opts.comment}`);
  const text = lines.join('\n');
  const html = wrapHtml(`Time off ${verb}`, [
    greeting(opts.firstName),
    `Your time-off request for <strong>${range}</strong> was ${verb}.`,
    ...(opts.comment ? [`Note from your manager: ${opts.comment}`] : []),
  ]);
  return { to: '', subject, html, text };
}

export function timeOffSubmittedEmail(opts: {
  workerName: string;
  startDate: string;
  endDate: string;
  reviewUrl: string;
}): EmailMessage {
  const subject = `New time-off request from ${opts.workerName}`;
  const range = `${opts.startDate} to ${opts.endDate}`;
  const text = [
    `${opts.workerName} requested time off for ${range}.`,
    '',
    `Review it here: ${opts.reviewUrl}`,
  ].join('\n');
  const html = wrapHtml('New time-off request', [
    `${opts.workerName} requested time off for <strong>${range}</strong>.`,
    `<a href="${opts.reviewUrl}">Review the request</a>`,
  ]);
  return { to: '', subject, html, text };
}

// ---- Transports ------------------------------------------------------

class LogEmailTransport implements EmailTransport {
  readonly name = 'log';
  async send(msg: EmailMessage): Promise<void> {
    logger.info(
      { to: msg.to, subject: msg.subject },
      'email (log transport — set EMAIL_PROVIDER=resend to deliver)',
    );
  }
}

class ResendEmailTransport implements EmailTransport {
  readonly name = 'resend';
  private client: import('resend').Resend | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  private async getClient(): Promise<import('resend').Resend> {
    if (!this.client) {
      // Lazy import so the (heavy) SDK only loads when email is actually sent.
      const { Resend } = await import('resend');
      this.client = new Resend(this.apiKey);
    }
    return this.client;
  }

  async send(msg: EmailMessage): Promise<void> {
    const client = await this.getClient();
    const { error } = await client.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (error) throw new Error(`Resend delivery failed: ${error.message}`);
  }
}

export function createEmailTransport(env: AppEnv): EmailTransport {
  if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
    return new ResendEmailTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  return new LogEmailTransport();
}

let defaultTransport: EmailTransport | null = null;
function getDefaultTransport(): EmailTransport {
  if (!defaultTransport) defaultTransport = createEmailTransport(loadEnv());
  return defaultTransport;
}

/** Best-effort send: failures are logged, never thrown. */
export async function sendEmail(
  msg: EmailMessage,
  transport: EmailTransport = getDefaultTransport(),
): Promise<void> {
  try {
    await transport.send(msg);
  } catch (err) {
    logger.error({ err, to: msg.to, subject: msg.subject }, 'failed to send email');
  }
}
