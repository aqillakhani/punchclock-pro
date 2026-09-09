import { InMemorySyncQueueRepo } from '@/db/repos/sync-queue.fake';
import { backoffFor } from '@/db/repos/sync-queue.repo';
import { createSyncService, type ServerPoster, type ServerResult } from '@/services/sync.service';
import type { NewQueueItem, QueueItem } from '@/db/types';

function makeNow(t: number) {
  return () => t;
}

function alwaysOk(serverId: string): ServerPoster {
  return async () => ({ ok: true, serverId }) as ServerResult;
}

function alwaysTransient(error: string): ServerPoster {
  return async () => ({ ok: false, kind: 'transient', error }) as ServerResult;
}

function alwaysConflict(reason: string): ServerPoster {
  return async () => ({ ok: false, kind: 'conflict', reason }) as ServerResult;
}

/** The device cannot reach the API at all (no signal, DNS, TLS, timeout). */
function alwaysUnreachable(error = 'Network request failed'): ServerPoster {
  return async () => ({ ok: false, kind: 'unreachable', error }) as ServerResult;
}

function recordingPoster(replies: Map<string, ServerResult>): {
  poster: ServerPoster;
  seen: QueueItem[];
} {
  const seen: QueueItem[] = [];
  const poster: ServerPoster = async (item) => {
    seen.push(item);
    const reply = replies.get(item.clientGeneratedId);
    if (!reply) throw new Error(`No reply scripted for ${item.clientGeneratedId}`);
    return reply;
  };
  return { poster, seen };
}

const samplePunchIn = (clientGeneratedId: string): NewQueueItem => ({
  clientGeneratedId,
  operationType: 'create_punch_in',
  priority: 1,
  payload: { timestamp: '2026-04-30T12:00:00Z' },
});

describe('sync.service.enqueue', () => {
  it('persists a new item with status=pending and retryCount=0', async () => {
    const repo = new InMemorySyncQueueRepo();
    const service = createSyncService({
      repo,
      poster: alwaysOk('server-1'),
      now: makeNow(1_000),
    });

    const queued = await service.enqueue(samplePunchIn('punch-abc'));

    expect(queued.status).toBe('pending');
    expect(queued.retryCount).toBe(0);
    expect(queued.queuedAt).toBe(1_000);
    expect(queued.serverId).toBeNull();
    expect(await repo.size()).toBe(1);
  });

  it('is idempotent: re-enqueueing same clientGeneratedId returns the existing row', async () => {
    const repo = new InMemorySyncQueueRepo();
    const service = createSyncService({
      repo,
      poster: alwaysOk('server-1'),
      now: makeNow(1_000),
    });

    const first = await service.enqueue(samplePunchIn('punch-abc'));
    const second = await service.enqueue(samplePunchIn('punch-abc'));

    expect(second.id).toBe(first.id);
    expect(await repo.size()).toBe(1);
  });
});

describe('sync.service.flush — success', () => {
  it('posts each eligible item and marks it synced with the returned serverId', async () => {
    const repo = new InMemorySyncQueueRepo();
    const replies = new Map<string, ServerResult>([
      ['punch-1', { ok: true, serverId: 's1' }],
      ['punch-2', { ok: true, serverId: 's2' }],
    ]);
    const { poster, seen } = recordingPoster(replies);
    const service = createSyncService({ repo, poster, now: makeNow(1_000) });

    await service.enqueue(samplePunchIn('punch-1'));
    await service.enqueue(samplePunchIn('punch-2'));

    const result = await service.flush();

    expect(result.synced).toBe(2);
    expect(seen.map((i) => i.clientGeneratedId).sort()).toEqual(['punch-1', 'punch-2']);

    const synced = await repo.listByStatus('synced');
    expect(synced).toHaveLength(2);
    expect(synced.find((s) => s.clientGeneratedId === 'punch-1')!.serverId).toBe('s1');
    expect(synced.find((s) => s.clientGeneratedId === 'punch-2')!.serverId).toBe('s2');

    const stillPending = await repo.listByStatus('pending');
    expect(stillPending).toHaveLength(0);
  });

  it('flushes higher-priority items before lower-priority items', async () => {
    const repo = new InMemorySyncQueueRepo();
    const replies = new Map<string, ServerResult>([
      ['low', { ok: true, serverId: 'sL' }],
      ['high', { ok: true, serverId: 'sH' }],
    ]);
    const { poster, seen } = recordingPoster(replies);
    const service = createSyncService({ repo, poster, now: makeNow(1_000) });

    await service.enqueue({ ...samplePunchIn('low'), priority: 0 });
    await service.enqueue({ ...samplePunchIn('high'), priority: 2 });

    await service.flush();

    expect(seen[0]!.clientGeneratedId).toBe('high');
    expect(seen[1]!.clientGeneratedId).toBe('low');
  });
});

describe('sync.service.flush — retry & backoff', () => {
  it('on transient failure: retryCount is incremented and the item stays pending', async () => {
    const repo = new InMemorySyncQueueRepo();
    const service = createSyncService({
      repo,
      poster: alwaysTransient('network down'),
      now: makeNow(1_000),
    });

    await service.enqueue(samplePunchIn('punch-1'));
    const result = await service.flush();

    expect(result.synced).toBe(0);
    expect(result.retried).toBe(1);

    const pending = await repo.listByStatus('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.retryCount).toBe(1);
    expect(pending[0]!.lastRetryAt).toBe(1_000);
    expect(pending[0]!.errorMessage).toBe('network down');
  });

  it('respects exponential backoff: a retried item is skipped until enough time has passed', async () => {
    const repo = new InMemorySyncQueueRepo();
    let nowMs = 1_000;
    const service = createSyncService({
      repo,
      poster: alwaysTransient('timeout'),
      now: () => nowMs,
    });

    await service.enqueue(samplePunchIn('punch-1'));
    await service.flush(); // retryCount=1 -> wait 1m

    nowMs = 31_000; // 30s later: still inside the 1m window
    const r1 = await service.flush();
    expect(r1.skipped).toBe(1);
    expect(r1.retried).toBe(0);

    nowMs = 62_000; // past the 1m window: eligible again
    const r2 = await service.flush();
    expect(r2.retried).toBe(1);
    const pending = await repo.listByStatus('pending');
    expect(pending[0]!.retryCount).toBe(2); // backoff would be 5m next time
  });

  it('after maxRetries failures the item is moved to status=failed', async () => {
    const repo = new InMemorySyncQueueRepo();
    let nowMs = 1_000;
    const service = createSyncService({
      repo,
      poster: alwaysTransient('persistent failure'),
      now: () => nowMs,
      maxRetries: 3,
    });

    await service.enqueue(samplePunchIn('punch-1'));

    // 3 retry cycles, each past the backoff window (1m, then 5m)
    await service.flush(); // retryCount 0 -> 1, wait 1m
    nowMs += 61_000;
    await service.flush(); // retryCount 1 -> 2, wait 5m
    nowMs += 5 * 60_000 + 1_000;
    await service.flush(); // retryCount 2 -> 3, exceeds maxRetries

    expect(await repo.countByStatus('pending')).toBe(0);
    const failed = await repo.listByStatus('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.retryCount).toBe(3);
    expect(failed[0]!.errorMessage).toBe('persistent failure');
  });
});

describe('sync.service.flush — conflict', () => {
  it('marks conflicted items as status=conflict and stops retrying them', async () => {
    const repo = new InMemorySyncQueueRepo();
    const service = createSyncService({
      repo,
      poster: alwaysConflict('timestamp_collision'),
      now: makeNow(1_000),
    });

    await service.enqueue(samplePunchIn('punch-1'));

    const r1 = await service.flush();
    expect(r1.conflicts).toBe(1);

    // Second flush: no eligible items, conflict is terminal.
    const r2 = await service.flush();
    expect(r2.synced).toBe(0);
    expect(r2.retried).toBe(0);
    expect(r2.conflicts).toBe(0);

    const conflicts = await repo.listByStatus('conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.conflictReason).toBe('timestamp_collision');
  });
});

describe('sync.service — restart durability', () => {
  it('a fresh service against the same repo sees previously-queued items', async () => {
    const repo = new InMemorySyncQueueRepo();
    const nowFirst = makeNow(1_000);

    // Session A: enqueue 5 punches, the device is offline the whole time.
    const sessionA = createSyncService({
      repo,
      poster: alwaysUnreachable(),
      now: nowFirst,
    });
    for (let i = 0; i < 5; i += 1) {
      await sessionA.enqueue(samplePunchIn(`punch-${i}`));
    }
    await sessionA.flush();
    expect(await repo.countByStatus('pending')).toBe(5);

    // Session B: app restarts. Same repo (= same SQLite file in prod),
    // but flushes now succeed. All 5 sync.
    const replies = new Map<string, ServerResult>();
    for (let i = 0; i < 5; i += 1) {
      replies.set(`punch-${i}`, { ok: true, serverId: `s-${i}` });
    }
    const { poster } = recordingPoster(replies);
    const sessionB = createSyncService({
      repo,
      poster,
      // Far enough in the future to clear any backoff window.
      now: makeNow(60_000),
    });
    const result = await sessionB.flush();

    expect(result.synced).toBe(5);
    expect(await repo.countByStatus('pending')).toBe(0);
    expect(await repo.countByStatus('synced')).toBe(5);
  });
});

describe('sync.service.flush — offline (server unreachable)', () => {
  // The regression this whole file exists to prevent: a worker punches
  // somewhere with no signal. The auto-sync loop keeps ticking. Before
  // the fix, each tick counted as a failed attempt and the punch was
  // discarded a few minutes later.
  it('never consumes retry budget while the device is offline', async () => {
    const repo = new InMemorySyncQueueRepo();
    let nowMs = 1_000;
    const service = createSyncService({
      repo,
      poster: alwaysUnreachable(),
      now: () => nowMs,
      maxRetries: 3,
    });

    await service.enqueue(samplePunchIn('punch-1'));

    // A full 24 hours of 60s auto-sync ticks with no connectivity.
    for (let tick = 0; tick < 24 * 60; tick += 1) {
      const summary = await service.flush();
      expect(summary.deferred).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.retried).toBe(0);
      nowMs += 60_000;
    }

    expect(await repo.countByStatus('failed')).toBe(0);
    const pending = await repo.listByStatus('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.retryCount).toBe(0);
    expect(pending[0]!.lastRetryAt).toBeNull();
  });

  it('delivers the punch once connectivity returns, days later', async () => {
    const repo = new InMemorySyncQueueRepo();
    let nowMs = 1_000;
    let online = false;
    const poster: ServerPoster = async () =>
      online
        ? ({ ok: true, serverId: 'srv-1' } as ServerResult)
        : ({ ok: false, kind: 'unreachable', error: 'offline' } as ServerResult);

    const service = createSyncService({ repo, poster, now: () => nowMs, maxRetries: 3 });
    await service.enqueue(samplePunchIn('punch-1'));

    for (let tick = 0; tick < 72 * 60; tick += 1) {
      await service.flush();
      nowMs += 60_000;
    }

    online = true;
    const summary = await service.flush();

    expect(summary.synced).toBe(1);
    expect(await repo.countByStatus('synced')).toBe(1);
    expect(await repo.countByStatus('pending')).toBe(0);
  });

  it('stops the batch at the first unreachable item and defers the rest', async () => {
    const repo = new InMemorySyncQueueRepo();
    const attempted: string[] = [];
    const poster: ServerPoster = async (item) => {
      attempted.push(item.clientGeneratedId);
      return { ok: false, kind: 'unreachable', error: 'offline' } as ServerResult;
    };
    const service = createSyncService({ repo, poster, now: makeNow(1_000) });

    for (let i = 0; i < 5; i += 1) {
      await service.enqueue(samplePunchIn(`punch-${i}`));
    }

    const summary = await service.flush();

    // One attempt proves the network is down; the other four would each
    // burn a full client timeout for nothing.
    expect(attempted).toHaveLength(1);
    expect(summary.deferred).toBe(5);
    expect(await repo.countByStatus('pending')).toBe(5);
  });

  it('still fails an item when the server answers with errors', async () => {
    // Being reachable-but-broken is a different thing from being offline,
    // and must still exhaust the budget so one poison item cannot block
    // the queue forever.
    const repo = new InMemorySyncQueueRepo();
    let nowMs = 1_000;
    const service = createSyncService({
      repo,
      poster: alwaysTransient('INTERNAL_ERROR'),
      now: () => nowMs,
      maxRetries: 2,
    });

    await service.enqueue(samplePunchIn('punch-1'));
    await service.flush();
    nowMs += 61_000;
    await service.flush();

    expect(await repo.countByStatus('failed')).toBe(1);
  });
});

describe('sync.service.retryFailed', () => {
  it('returns failed items to the queue with a clean budget and sends them', async () => {
    const repo = new InMemorySyncQueueRepo();
    let nowMs = 1_000;
    let broken = true;
    const poster: ServerPoster = async () =>
      broken
        ? ({ ok: false, kind: 'transient', error: 'INTERNAL_ERROR' } as ServerResult)
        : ({ ok: true, serverId: 'srv-1' } as ServerResult);

    const service = createSyncService({ repo, poster, now: () => nowMs, maxRetries: 2 });
    await service.enqueue(samplePunchIn('punch-1'));
    await service.flush();
    nowMs += 61_000;
    await service.flush();
    expect(await service.failedCount()).toBe(1);

    // The outage is over and the worker taps "Try again".
    broken = false;
    const moved = await service.retryFailed();
    expect(moved).toBe(1);
    expect(await service.failedCount()).toBe(0);

    const requeued = await repo.listByStatus('pending');
    expect(requeued[0]!.retryCount).toBe(0);
    expect(requeued[0]!.lastRetryAt).toBeNull();

    const summary = await service.flush();
    expect(summary.synced).toBe(1);
  });

  it('leaves conflicted items alone — those are decided, not stuck', async () => {
    const repo = new InMemorySyncQueueRepo();
    const service = createSyncService({
      repo,
      poster: alwaysConflict('TIMESTAMP_COLLISION'),
      now: makeNow(1_000),
    });

    await service.enqueue(samplePunchIn('punch-1'));
    await service.flush();

    expect(await service.retryFailed()).toBe(0);
    expect(await repo.countByStatus('conflict')).toBe(1);
  });
});

describe('backoffFor', () => {
  it('spaces retries in minutes, not seconds, so a 60s tick cannot burn the budget', () => {
    expect(backoffFor(0)).toBe(0);
    expect(backoffFor(1)).toBe(60_000);
    expect(backoffFor(2)).toBe(5 * 60_000);
    expect(backoffFor(3)).toBe(15 * 60_000);
    // Every step is at least as long as the auto-sync interval.
    for (let n = 1; n <= 10; n += 1) {
      expect(backoffFor(n)).toBeGreaterThanOrEqual(60_000);
    }
  });

  it('holds at one hour rather than growing without bound', () => {
    expect(backoffFor(5)).toBe(60 * 60_000);
    expect(backoffFor(50)).toBe(60 * 60_000);
  });
});

describe('sync.service.flush — losing the network mid-batch', () => {
  it('keeps what it delivered and defers the rest untouched', async () => {
    const repo = new InMemorySyncQueueRepo();
    const attempted: string[] = [];
    let delivered = 0;
    const poster: ServerPoster = async (item) => {
      attempted.push(item.clientGeneratedId);
      if (delivered < 2) {
        delivered += 1;
        return { ok: true, serverId: `srv-${delivered}` } as ServerResult;
      }
      return { ok: false, kind: 'unreachable', error: 'signal lost' } as ServerResult;
    };
    const service = createSyncService({ repo, poster, now: makeNow(1_000) });

    for (let i = 0; i < 5; i += 1) {
      await service.enqueue(samplePunchIn(`punch-${i}`));
    }

    const summary = await service.flush();

    expect(summary.synced).toBe(2);
    // Three left: the one the network died on, plus the two never tried.
    expect(summary.deferred).toBe(3);
    expect(summary.failed).toBe(0);
    expect(attempted).toHaveLength(3);

    expect(await repo.countByStatus('synced')).toBe(2);
    expect(await repo.countByStatus('pending')).toBe(3);
    for (const item of await repo.listByStatus('pending')) {
      expect(item.retryCount).toBe(0);
      expect(item.lastRetryAt).toBeNull();
    }
  });

  it('will not revive an item that a concurrent flush already delivered', async () => {
    const repo = new InMemorySyncQueueRepo();
    const queued = await repo.enqueue(samplePunchIn('punch-1'), 1_000);
    await repo.markSynced(queued.id, 'srv-1');

    // requeue must refuse anything that is not parked as 'failed', or the
    // retry button would send a delivered punch a second time.
    expect(await repo.requeue(queued.id)).toBeNull();
    expect(await repo.countByStatus('synced')).toBe(1);
    expect(await repo.countByStatus('pending')).toBe(0);
  });
});
