import { Redis } from 'ioredis';
import { loadEnv } from './env.js';
import { logger } from './logger.js';

/**
 * Shared Redis client. Used for the Socket.io cross-instance adapter (when
 * scaled past one machine) and as the backing store for distributed rate
 * limiting. Connections are lazy so importing this module never blocks on
 * Redis, and a Redis outage degrades gracefully rather than crashing.
 */
let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  const env = loadEnv();
  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  });
  client.on('error', (err: Error) => {
    // Debug level: a Redis blip shouldn't spam error logs; health + rate
    // limiting both degrade gracefully when Redis is unreachable.
    logger.debug({ err: err.message }, 'redis connection error');
  });
  return client;
}

/**
 * Returns true iff Redis answers PING within `timeoutMs`. Never throws —
 * a timeout or connection failure resolves to false.
 */
export async function pingRedis(timeoutMs = 1000): Promise<boolean> {
  const pingPromise = getRedis()
    .ping()
    .then((reply: string) => reply === 'PONG')
    .catch(() => false);
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), timeoutMs).unref();
  });
  return Promise.race([pingPromise, timeout]);
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    // ignore — we're shutting down
  } finally {
    client = null;
  }
}
