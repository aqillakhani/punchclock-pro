import './config/load-env.js';
import http from 'node:http';
import { createApp } from './app.js';
import { corsOrigins, loadEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { createSocketServer } from './realtime/socket.js';
import { attachRedisAdapter } from './realtime/redis-adapter.js';
import { closePool } from './config/database.js';
import { closeRedis } from './config/redis.js';
import { initSentry } from './config/sentry.js';
import { scheduledJobs } from './jobs/index.js';
import { startScheduler } from './jobs/scheduler.js';

async function main(): Promise<void> {
  const env = loadEnv();
  initSentry(env);
  const app = createApp();
  const server = http.createServer(app);
  attachRedisAdapter(createSocketServer(server, corsOrigins(env)));

  server.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT, env: env.NODE_ENV }, 'PunchClock Pro API started');
  });

  const stopScheduler = startScheduler(scheduledJobs(env), {
    initialDelayMs: env.SCHEDULED_JOBS_INITIAL_DELAY_SECONDS * 1_000,
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    // Stops new passes immediately; resolves once any in-flight sweep has
    // finished its transaction. Awaited before the pool closes, because
    // closing under an open sweep just rolls its work back. If the forced
    // exit below wins the race that rollback is still safe — every pass is
    // a single transaction, so it is all-or-nothing and the next tick
    // simply redoes it.
    const drained = stopScheduler();
    server.close(async () => {
      await drained;
      await closePool();
      await closeRedis();
      process.exit(0);
    });
    // Force exit after 10s.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
