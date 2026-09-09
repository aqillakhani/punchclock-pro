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
    status: reply.status,
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

  it('treats a network failure as unreachable, not as a failed attempt', async () => {
    // The server never saw the punch, so this must not count against the
    // item's retry budget — otherwise time spent out of signal destroys it.
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network request failed'))) as unknown as typeof fetch;

    const poster = makePoster(() => null);
    const result = await poster(sampleItem);

    expect(result).toEqual({ ok: false, kind: 'unreachable', error: 'Network request failed' });
  });

  it('treats a client-side timeout as unreachable', async () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    globalThis.fetch = (() => Promise.reject(abort)) as unknown as typeof fetch;

    const poster = makePoster(() => null);
    const result = await poster(sampleItem);

    expect(result).toEqual({ ok: false, kind: 'unreachable', error: 'Aborted' });
  });

  it('treats a non-JSON gateway body as unreachable', async () => {
    // A Fly/proxy 502 returns HTML, so res.json() throws with no API
    // error code. The request never produced an API response either.
    globalThis.fetch = (async () => ({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    })) as unknown as typeof fetch;

    const poster = makePoster(() => null);
    const result = await poster(sampleItem);

    expect(result).toEqual({
      ok: false,
      kind: 'unreachable',
      error: 'Unexpected token < in JSON at position 0',
    });
  });
});

describe('makePoster — responses that lie', () => {
  it('does not treat an HTTP 500 as delivered just because the body says success', async () => {
    // A proxy or gateway can rewrite a response envelope. Believing the body
    // here would mark the punch synced and drop it from the queue for good.
    mockFetch({
      status: 500,
      body: { success: true, data: { entry: { id: 'srv-1' } } },
    });

    const poster = makePoster(() => null);
    const result = await poster(sampleItem);

    expect(result).toEqual({ ok: false, kind: 'unreachable', error: 'HTTP 500' });
  });

  it('refuses a success response that carries no server id', async () => {
    mockFetch({ status: 200, body: { success: true, data: {} } });

    const poster = makePoster(() => null);
    const result = await poster(sampleItem);

    expect(result).toMatchObject({ ok: false, kind: 'transient' });
  });
});
