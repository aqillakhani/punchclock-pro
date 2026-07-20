import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import { createAdapterClients } from '../config/redis.js';
import { logger } from '../config/logger.js';

/** Injected so the wiring decision can be unit-tested without a live Redis. */
export interface RedisAdapterDeps {
  getClients: () => { pub: Redis; sub: Redis } | null;
  buildAdapter: typeof createAdapter;
}

const defaultDeps: RedisAdapterDeps = {
  getClients: createAdapterClients,
  buildAdapter: createAdapter,
};

/**
 * Fan Socket.io broadcasts out across API instances over Redis pub/sub.
 *
 * No-op when REDIS_URL is unset. That is the supported single-instance
 * configuration: one machine's in-memory adapter already reaches every
 * connected client, so Redis buys nothing until there are two. Wiring it
 * conditionally means scaling up is a secret + `fly scale count`, not a
 * code change.
 *
 * Returns true iff the Redis adapter was installed.
 */
export function attachRedisAdapter(io: Server, deps: RedisAdapterDeps = defaultDeps): boolean {
  const clients = deps.getClients();
  if (!clients) {
    logger.info('REDIS_URL unset — Socket.io using the in-memory adapter (single instance)');
    return false;
  }
  io.adapter(deps.buildAdapter(clients.pub, clients.sub));
  logger.info('Socket.io Redis adapter installed — broadcasts fan out across instances');
  return true;
}
