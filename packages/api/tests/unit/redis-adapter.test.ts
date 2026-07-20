import { describe, it, expect, jest } from '@jest/globals';
import type { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import { attachRedisAdapter, type RedisAdapterDeps } from '../../src/realtime/redis-adapter.js';

/**
 * `attachRedisAdapter` is the wiring whose *absence* caused the original
 * incident: `socket.ts` documented a Redis adapter installed by `index.ts`
 * that had never been written. These tests pin both halves of its contract —
 * install when Redis is configured, stay out of the way when it isn't — so
 * the comment cannot drift away from the code again.
 */

/** Minimal Socket.io server stand-in; only `adapter()` is exercised. */
function fakeIo(): Server & { adapter: jest.Mock } {
  return { adapter: jest.fn() } as unknown as Server & { adapter: jest.Mock };
}

const pub = { tag: 'pub' } as unknown as Redis;
const sub = { tag: 'sub' } as unknown as Redis;

function depsWith(clients: { pub: Redis; sub: Redis } | null): RedisAdapterDeps & {
  buildAdapter: jest.Mock;
} {
  const buildAdapter = jest.fn(() => 'adapter-factory');
  return {
    getClients: () => clients,
    buildAdapter: buildAdapter as unknown as RedisAdapterDeps['buildAdapter'],
  } as RedisAdapterDeps & { buildAdapter: jest.Mock };
}

describe('attachRedisAdapter()', () => {
  it('installs the Redis adapter when Redis is configured', () => {
    const deps = depsWith({ pub, sub });
    const io = fakeIo();

    expect(attachRedisAdapter(io, deps)).toBe(true);
    // Order matters: swapping these leaves the publishing client stuck in
    // subscriber mode, where it cannot issue publish commands.
    expect(deps.buildAdapter).toHaveBeenCalledWith(pub, sub);
    expect(io.adapter).toHaveBeenCalledWith('adapter-factory');
  });

  it('leaves Socket.io on its in-memory adapter when Redis is not configured', () => {
    const deps = depsWith(null);
    const io = fakeIo();

    expect(attachRedisAdapter(io, deps)).toBe(false);
    expect(deps.buildAdapter).not.toHaveBeenCalled();
    // Critical: it must not call io.adapter(undefined), which would replace a
    // working in-memory adapter with nothing and silently kill all broadcasts.
    expect(io.adapter).not.toHaveBeenCalled();
  });

  it('defaults to the real collaborators when no deps are supplied', () => {
    // REDIS_URL is unset under tests/setup-env.ts, so the production wiring
    // must resolve to the no-op branch rather than throwing.
    const io = fakeIo();
    expect(attachRedisAdapter(io)).toBe(false);
    expect(io.adapter).not.toHaveBeenCalled();
  });
});
