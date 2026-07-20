import { describe, it, expect, afterEach, jest } from '@jest/globals';
import {
  describeRedisError,
  pingReplyToState,
  withProbeTimeout,
  type RedisState,
} from '../../src/config/redis.logic.js';

describe('pingReplyToState()', () => {
  it('treats the literal PONG as up', () => {
    expect(pingReplyToState('PONG')).toBe('up');
  });

  it('treats any other reply as down', () => {
    expect(pingReplyToState('')).toBe('down');
    expect(pingReplyToState('pong')).toBe('down');
    expect(pingReplyToState('LOADING Redis is loading the dataset in memory')).toBe('down');
  });
});

describe('describeRedisError()', () => {
  it('unwraps the AggregateError ioredis raises on a dual-stack host', () => {
    // The regression this exists for: `.message` is '' and the real causes are
    // in `.errors`, so logging err.message printed an empty string.
    const err = new AggregateError([
      new Error('connect ECONNREFUSED ::1:6379'),
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    ]);
    expect(err.message).toBe('');
    expect(describeRedisError(err)).toBe(
      'connect ECONNREFUSED ::1:6379; connect ECONNREFUSED 127.0.0.1:6379',
    );
  });

  it('collapses identical causes rather than repeating them', () => {
    const err = new AggregateError([new Error('ETIMEDOUT'), new Error('ETIMEDOUT')]);
    expect(describeRedisError(err)).toBe('ETIMEDOUT');
  });

  it('falls back to the aggregate message when it has no inner errors', () => {
    expect(describeRedisError(new AggregateError([], 'everything failed'))).toBe(
      'everything failed',
    );
  });

  it('passes a plain Error message straight through', () => {
    expect(describeRedisError(new Error('READONLY You cannot write'))).toBe(
      'READONLY You cannot write',
    );
  });

  it('never returns an empty string, whatever it is handed', () => {
    for (const input of [new Error(''), new TypeError(''), {}, null, undefined, '']) {
      expect(describeRedisError(input).length).toBeGreaterThan(0);
    }
  });
});

describe('withProbeTimeout()', () => {
  const never = new Promise<RedisState>(() => {});

  it('passes through a probe that settles in time', async () => {
    await expect(withProbeTimeout(Promise.resolve('up'), 1000)).resolves.toBe('up');
    await expect(withProbeTimeout(Promise.resolve('down'), 1000)).resolves.toBe('down');
  });

  it('folds a rejected probe to down rather than throwing', async () => {
    await expect(withProbeTimeout(Promise.reject(new Error('ECONNREFUSED')), 1000)).resolves.toBe(
      'down',
    );
  });

  it('resolves down when the probe never settles — a blackholed connect', async () => {
    const started = Date.now();
    await expect(withProbeTimeout(never, 50)).resolves.toBe('down');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not keep the process alive waiting on its own timer', () => {
    // The timeout timer is unref'd: a pending health probe must never be the
    // reason a shutting-down process refuses to exit.
    const spy = jest.spyOn(global, 'setTimeout');
    void withProbeTimeout(never, 60_000);
    const timer = spy.mock.results.at(-1)?.value as { hasRef?: () => boolean };
    expect(timer.hasRef?.()).toBe(false);
    spy.mockRestore();
  });
});

/**
 * `config/redis.ts` caches both the parsed env and its clients at module
 * scope, so each scenario needs a fresh module registry. Nothing here opens a
 * socket: clients are created with `lazyConnect`, and reachability behavior is
 * covered by the pure tests above.
 */
type RedisModule = typeof import('../../src/config/redis.js');

const originalUrl = process.env.REDIS_URL;
let active: RedisModule | null = null;

async function loadFresh(redisUrl?: string): Promise<RedisModule> {
  jest.resetModules();
  if (redisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = redisUrl;
  active = await import('../../src/config/redis.js');
  return active;
}

afterEach(async () => {
  if (active) await active.closeRedis();
  active = null;
  if (originalUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalUrl;
});

describe('redis module — REDIS_URL unset', () => {
  it('reports Redis as not configured', async () => {
    const redis = await loadFresh(undefined);
    expect(redis.isRedisConfigured()).toBe(false);
  });

  it('probes as "disabled", not "down"', async () => {
    const redis = await loadFresh(undefined);
    await expect(redis.probeRedis()).resolves.toBe('disabled');
  });

  it('hands out no adapter clients, so Socket.io stays on the in-memory adapter', async () => {
    const redis = await loadFresh(undefined);
    expect(redis.createAdapterClients()).toBeNull();
  });

  it('closes cleanly even though nothing was ever opened', async () => {
    const redis = await loadFresh(undefined);
    await expect(redis.closeRedis()).resolves.toBeUndefined();
  });
});

describe('redis module — REDIS_URL set', () => {
  const URL = 'redis://127.0.0.1:6390';

  it('reports Redis as configured', async () => {
    const redis = await loadFresh(URL);
    expect(redis.isRedisConfigured()).toBe(true);
  });

  it('hands out a distinct pub/sub client pair for the adapter', async () => {
    const redis = await loadFresh(URL);
    const clients = redis.createAdapterClients();
    expect(clients).not.toBeNull();
    // Socket.io needs two connections: one stays in subscriber mode and cannot
    // issue the publish commands the other one does.
    expect(clients?.pub).not.toBe(clients?.sub);
  });

  it('creates adapter clients lazily — constructing them opens no connection', async () => {
    const redis = await loadFresh(URL);
    const clients = redis.createAdapterClients();
    expect(clients?.pub.status).toBe('wait');
    expect(clients?.sub.status).toBe('wait');
  });

  it('gives adapter clients unlimited request retries, as subscriber mode needs', async () => {
    const redis = await loadFresh(URL);
    const clients = redis.createAdapterClients();
    expect(clients?.sub.options.maxRetriesPerRequest).toBeNull();
    expect(clients?.pub.options.maxRetriesPerRequest).toBeNull();
  });
});

describe('redis module — shutdown is final', () => {
  const URL = 'redis://127.0.0.1:6390';

  it('opens no new connections once closeRedis() has run', async () => {
    // Otherwise a probe landing mid-shutdown would register a fresh client in
    // the set shutdown already drained, leaking it past process exit.
    const redis = await loadFresh(URL);
    expect(redis.createAdapterClients()).not.toBeNull();

    await redis.closeRedis();

    expect(redis.createAdapterClients()).toBeNull();
  });

  it('reports a configured-but-closing Redis as "down", never "disabled"', async () => {
    const redis = await loadFresh(URL);
    await redis.closeRedis();
    // 'disabled' maps to a healthy /health; a configured Redis we can no longer
    // reach must not be laundered into an "ok" report.
    await expect(redis.probeRedis(100)).resolves.toBe('down');
  });

  it('still reports "disabled" after shutdown when Redis was never configured', async () => {
    const redis = await loadFresh(undefined);
    await redis.closeRedis();
    await expect(redis.probeRedis(100)).resolves.toBe('disabled');
  });
});
