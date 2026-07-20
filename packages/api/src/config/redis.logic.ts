/**
 * Pure Redis-probe logic — no client, no sockets, no env — so the rules that
 * decide what /health reports can be unit-tested without a Redis to point at.
 * The I/O lives in `redis.ts`.
 */

/**
 * Redis is optional, so it has a third state beyond up/down: 'disabled' means
 * REDIS_URL was never configured, which is a supported single-instance setup
 * rather than a fault.
 */
export type RedisState = 'up' | 'down' | 'disabled';

/** A healthy Redis answers PING with the literal 'PONG'; anything else is a fault. */
export function pingReplyToState(reply: string): RedisState {
  return reply === 'PONG' ? 'up' : 'down';
}

/**
 * Render a connection failure as something worth reading.
 *
 * On a dual-stack host — which is to say almost every host — a refused
 * connection reaches us as an `AggregateError` whose own `message` is the empty
 * string, with the real causes ("connect ECONNREFUSED ::1:6379", …) buried in
 * `.errors`. Logging `err.message` there prints nothing at all, which is how a
 * Redis that was never reachable can look identical to one nobody asked about.
 */
export function describeRedisError(err: unknown): string {
  if (err instanceof AggregateError) {
    const causes = err.errors.map(describeRedisError).filter(Boolean);
    if (causes.length > 0) return [...new Set(causes)].join('; ');
  }
  if (err instanceof Error) return err.message.trim() || err.name;
  const described = String(err).trim();
  // A blank or opaque value tells an operator nothing; say so explicitly
  // rather than emitting a log line with an empty reason.
  return described && described !== '[object Object]' ? described : 'unknown redis error';
}

/**
 * Resolve `probe`, or 'down' if it hasn't settled within `timeoutMs`.
 *
 * A health endpoint must answer on a bounded schedule. An unreachable Redis
 * frequently leaves the connect attempt pending far longer than a caller can
 * wait — a blackholed TCP connect can hang until the OS gives up — and a probe
 * that never answers is indistinguishable from an unhealthy one. Rejections
 * are folded to 'down' for the same reason.
 */
export function withProbeTimeout(
  probe: Promise<RedisState>,
  timeoutMs: number,
): Promise<RedisState> {
  const timeout = new Promise<RedisState>((resolve) => {
    setTimeout(() => resolve('down'), timeoutMs).unref();
  });
  return Promise.race([probe.catch((): RedisState => 'down'), timeout]);
}
