import { describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { securityHeaders } from '../../src/config/security.js';

function appWithHeaders(): express.Express {
  const app = express();
  app.use(securityHeaders());
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('securityHeaders()', () => {
  it('sets a strict default-src none CSP (the API serves only JSON)', async () => {
    const res = await request(appWithHeaders()).get('/ping');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('blocks framing and MIME-type sniffing', async () => {
    const res = await request(appWithHeaders()).get('/ping');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('enables HSTS with a long max-age', async () => {
    const res = await request(appWithHeaders()).get('/ping');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d{7,}/);
  });

  it('does not leak the framework via x-powered-by', async () => {
    const res = await request(appWithHeaders()).get('/ping');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
