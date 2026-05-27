import { describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import {
  assembleHealth,
  healthHttpStatus,
  type ProbeState,
} from '../../src/routes/health.logic.js';
import { buildHealthRouter } from '../../src/routes/health.js';

describe('assembleHealth()', () => {
  it('is "ok" when db and redis are up', () => {
    expect(assembleHealth({ version: 'v1', db: 'up', redis: 'up' })).toEqual({
      status: 'ok',
      version: 'v1',
      db: 'up',
      redis: 'up',
    });
  });

  it('is "degraded" when redis is down but db is up', () => {
    expect(assembleHealth({ version: 'v1', db: 'up', redis: 'down' }).status).toBe('degraded');
  });

  it('is "error" when db is down regardless of redis', () => {
    expect(assembleHealth({ version: 'v1', db: 'down', redis: 'up' }).status).toBe('error');
    expect(assembleHealth({ version: 'v1', db: 'down', redis: 'down' }).status).toBe('error');
  });
});

describe('healthHttpStatus()', () => {
  it('returns 503 only when the service is in error (db down)', () => {
    expect(healthHttpStatus({ status: 'error', version: 'v', db: 'down', redis: 'up' })).toBe(503);
    expect(healthHttpStatus({ status: 'degraded', version: 'v', db: 'up', redis: 'down' })).toBe(
      200,
    );
    expect(healthHttpStatus({ status: 'ok', version: 'v', db: 'up', redis: 'up' })).toBe(200);
  });
});

describe('GET /health router', () => {
  function appWith(
    probeDb: () => Promise<ProbeState>,
    probeRedis: () => Promise<ProbeState>,
    version = 'test-sha',
  ): express.Express {
    const app = express();
    app.use('/health', buildHealthRouter({ getVersion: () => version, probeDb, probeRedis }));
    return app;
  }

  it('returns 200 and the full report when all probes are up', async () => {
    const res = await request(
      appWith(
        async () => 'up',
        async () => 'up',
      ),
    ).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'ok',
      version: 'test-sha',
      db: 'up',
      redis: 'up',
    });
  });

  it('returns 503 when the database probe reports down', async () => {
    const res = await request(
      appWith(
        async () => 'down',
        async () => 'up',
      ),
    ).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('error');
  });

  it('returns 200 (degraded) when only redis is down', async () => {
    const res = await request(
      appWith(
        async () => 'up',
        async () => 'down',
      ),
    ).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('degraded');
  });

  it('still answers /health/live as a simple liveness probe', async () => {
    const res = await request(
      appWith(
        async () => 'down',
        async () => 'down',
      ),
    ).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });
});
