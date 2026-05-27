import { describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import type { Request } from 'express';
import { createRateLimiter, ipKey, userOrIpKey } from '../../src/middleware/rate-limit.js';

describe('rate-limit key generators', () => {
  it('ipKey keys by request IP', () => {
    expect(ipKey({ ip: '1.2.3.4' } as Request)).toBe('ip:1.2.3.4');
  });

  it('userOrIpKey prefers the authenticated user id', () => {
    expect(userOrIpKey({ ip: '1.2.3.4', user: { userId: 'u1' } } as unknown as Request)).toBe(
      'user:u1',
    );
  });

  it('userOrIpKey falls back to IP when anonymous', () => {
    expect(userOrIpKey({ ip: '9.9.9.9' } as Request)).toBe('ip:9.9.9.9');
  });
});

describe('createRateLimiter()', () => {
  function appWithLimit(limit: number): express.Express {
    const app = express();
    const limiter = createRateLimiter({ windowMs: 60_000, limit, message: 'slow down please' });
    app.post('/x', limiter, (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('allows requests up to the limit, then returns 429 with our error envelope', async () => {
    const app = appWithLimit(2);
    expect((await request(app).post('/x')).status).toBe(200);
    expect((await request(app).post('/x')).status).toBe(200);
    const blocked = await request(app).post('/x');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'slow down please' },
    });
  });

  it('advertises the limit via standard RateLimit headers', async () => {
    const res = await request(appWithLimit(5)).post('/x');
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeUndefined(); // legacy headers off
  });
});
