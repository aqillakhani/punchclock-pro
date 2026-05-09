import { makePoster } from '@/services/sync.bootstrap';
import type { QueueItem } from '@/db/types';

const sampleItem: QueueItem = {
  id: 'q_1',
  clientGeneratedId: 'punch-abc',
  operationType: 'create_punch_in',
  payload: { timestamp: '2026-04-30T12:00:00Z' },
  priority: 1,
  retryCount: 0,
  lastRetryAt: null,
  queuedAt: 0,
  status: 'pending',
  serverId: null,
  errorMessage: null,
  conflictReason: null,
};

interface MockFetchInit {
  status: number;
  body: object;
}

function mockFetch(reply: MockFetchInit) {
  globalThis.fetch = (async () => ({
    ok: reply.status >= 200 && reply.status < 300,
    json: async () => reply.body,
  })) as unknown as typeof fetch;
}

describe('makePoster', () => {
  it('returns ok with serverId when the API responds with success', async () => {
    mockFetch({
      status: 200,
      body: { success: true, data: { entry: { id: 'srv-99' } } },
    });

    const poster = makePoster(() => null);
    const result = await poster(sampleItem);

    expect(result).toEqual({ ok: true, serverId: 'srv-99' });
  });

  it('maps known conflict codes to a conflict result (no further retry)', async () => {
    mockFetch({
      status: 409,
      body: {
        success: false,
        error: { code: 'TIMESTAMP_COLLISION', message: 'overlapping punch' },
      },
    });

    const poster = makePoster(() => null);
    const result = await poster(sampleItem);

    expect(result).toEqual({ ok: false, kind: 'conflict', reason: 'TIMESTAMP_COLLISION' });
  });

  it('treats other errors as transient so they get retried', async () => {
    mockFetch({
      status: 500,
      body: {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'database unavailable' },
      },
    });

    const poster = makePoster(() => null);
    const result = await poster(sampleItem);

    expect(result).toEqual({ ok: false, kind: 'transient', error: 'database unavailable' });
  });

  it('treats network failures as transient', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('Network request failed'))) as unknown as typeof fetch;

    const poster = makePoster(() => null);
    const result = await poster(sampleItem);

    expect(result).toEqual({ ok: false, kind: 'transient', error: 'Network request failed' });
  });
});
