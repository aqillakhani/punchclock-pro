import { Redis, type RedisOptions } from 'ioredis';
import { loadEnv } from './env.js';
import { logger } from './logger.js';
import {
  describeRedisError,
  pingReplyToState,
  withProbeTimeout,
  type RedisState,
} from './redis.logic.js';

export type { RedisState };

/**
 * Redis is an *optional* dependency of the API.
 *
 * A single API instance needs no Redis at all: Socket.io broadcasts correctly
 * from its in-memory adapter, and rate limiting deliberately uses an in-memory
 * store (see `middleware/rate-limit.ts`). Redis only becomes necessary once we
 * scale past one machine, where broadcasts must fan out across instances.
 *
 * So when REDIS_URL is unset there is nothing to connect to and nothing is
 * broken — `probeRedis()` reports 'disabled', not 'down'. When it *is* set we
 * hold it to the same standard as any other dependency: a real connection,
 * surfaced honestly on /health.
 *
 * Connections are lazy so importing this module never blocks, and a Redis
 * outage degrades gracefully rather than crashing the process.
 */

const BASE_OPTIONS: RedisOptions = {
  lazyConnect: true,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
};

/** Every client handed out, so shutdown can close all of them. */
const openClients = new Set<Redis>();

let healthClient: Redis | null = null;

/**
 * Set once `closeRedis()` starts. Without it, a probe landing in the window
 * while shutdown awaits its clients would build a fresh connection, register
 * it in the set shutdown has already drained, and leave it open at exit.
 */
let shuttingDown = false;

/** True when REDIS_URL is configured, i.e. Redis-backed features are enabled. */
export function isRedisConfigured(): boolean {
  return Boolean(loadEnv().REDIS_URL);
}

function createClient(name: string, options: RedisOptions): Redis | null {
  const url = loadEnv().REDIS_URL;
  if (!url || shuttingDown) return null;
  const client = new Redis(url, { ...BASE_OPTIONS, ...options });
  client.on('error', (err: unknown) => {
    // Debug level: a Redis blip shouldn't spam error logs. Health reporting
    // and the Socket.io adapter both recover on reconnect. Logged under
    // `reason` rather than `err` because this is a string, not an Error —
    // pino reserves `err` for the real thing.
    logger.debug({ reason: describeRedisError(err), client: name }, 'redis connection error');
  });
  openClients.add(client);
  return client;
}

/**
 * Pub/sub client pair for the Socket.io Redis adapter, or null when Redis is
 * not configured. `maxRetriesPerRequest` is null on these by design: ioredis
 * puts a subscriber connection into a mode where a capped retry count surfaces
 * transient blips as hard command errors instead of letting it reconnect.
 */
export function createAdapterClients(): { pub: Redis; sub: Redis } | null {
  const pub = createClient('adapter-pub', { maxRetriesPerRequest: null });
  if (!pub) return null;
  const sub = createClient('adapter-sub', { maxRetriesPerRequest: null });
  if (!sub) return null;
  return { pub, sub };
}

/**
 * Reports Redis reachability for /health. Never throws and never hangs:
 * 'disabled' when unconfigured, 'up' on a PONG within `timeoutMs`, else 'down'.
 */
export async function probeRedis(timeoutMs = 1000): Promise<RedisState> {
  if (!healthClient) healthClient = createClient('health', { maxRetriesPerRequest: 2 });
  // No client means either Redis was never configured, or shutdown has latched
  // and refuses to open new connections. Only the first is 'disabled'; calling
  // a configured-but-closing Redis 'disabled' would misreport it as healthy.
  if (!healthClient) return isRedisConfigured() ? 'down' : 'disabled';
  return withProbeTimeout(healthClient.ping().then(pingReplyToState), timeoutMs);
}

/** How long a graceful QUIT may take before we drop the socket outright. */
const QUIT_TIMEOUT_MS = 2000;

/**
 * Close every open client. Safe to call when Redis was never configured, and
 * bounded: a client that is mid-reconnect can leave `quit()` pending forever,
 * which would stall shutdown, so an unresponsive client is disconnected.
 *
 * Latching `shuttingDown` first makes this final — no code path can open a new
 * connection behind it, so "all clients closed" stays true once it returns.
 */
export async function closeRedis(): Promise<void> {
  shuttingDown = true;
  const clients = [...openClients];
  openClients.clear();
  healthClient = null;
  await Promise.all(
    clients.map(async (client) => {
      // A lazy client that never connected ('wait') would *open* a connection
      // just to send QUIT. Drop it directly instead — same for one already
      // finished ('end'), where quit() never settles.
      if (client.status === 'wait' || client.status === 'end') {
        client.disconnect();
        return;
      }
      try {
        await Promise.race([
          client.quit(),
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('redis quit timed out')), QUIT_TIMEOUT_MS).unref();
          }),
        ]);
      } catch {
        // Still reconnecting, or already gone — drop the socket and move on.
        client.disconnect();
      }
    }),
  );
}
