import { InMemorySyncQueueRepo } from '@/db/repos/sync-queue.fake';
import {
  createSyncService,
  type ServerPoster,
  type ServerResult,
} from '@/services/sync.service';
import type { NewQueueItem, QueueItem } from '@/db/types';

function makeNow(t: number) {
  return () => t;
}

function alwaysOk(serverId: string): ServerPoster {
  return async () => ({ ok: true, serverId } as ServerResult);
}

function alwaysTransient(error: string): ServerPoster {
  return async () => ({ ok: false, kind: 'transient', error } as ServerResult);
}

function alwaysConflict(reason: string): ServerPoster {
  return async () => ({ ok: false, kind: 'conflict', reason } as ServerResult);
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
    await service.flush(); // retryCount=1 -> wait 1s

    nowMs = 1_500; // 500ms later: not eligible yet
    const r1 = await service.flush();
    expect(r1.skipped).toBe(1);
    expect(r1.retried).toBe(0);

    nowMs = 2_001; // 1001ms after retry: eligible
    const r2 = await service.flush();
    expect(r2.retried).toBe(1);
    const pending = await repo.listByStatus('pending');
    expect(pending[0]!.retryCount).toBe(2); // backoff would be 2s next time
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

    // 3 retry cycles, each past the backoff window
    await service.flush(); // retryCount 0 -> 1, wait 1s
    nowMs += 1_500;
    await service.flush(); // retryCount 1 -> 2, wait 2s
    nowMs += 2_500;
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

    // Session A: enqueue 5 punches, all flushes fail (offline).
    const sessionA = createSyncService({
      repo,
      poster: alwaysTransient('offline'),
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
