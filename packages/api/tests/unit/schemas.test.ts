import { describe, it, expect } from '@jest/globals';
import { punchInRequestSchema, syncBatchRequestSchema } from '@punchclock/shared';

describe('punchInRequestSchema', () => {
  it('accepts a minimal valid request', () => {
    const parsed = punchInRequestSchema.parse({
      clientGeneratedId: 'abc-123',
      timestamp: '2026-04-10T12:00:00.000Z',
    });
    expect(parsed.clientGeneratedId).toBe('abc-123');
  });

  it('validates a full request with location and device info', () => {
    const parsed = punchInRequestSchema.parse({
      clientGeneratedId: 'abc-123',
      timestamp: '2026-04-10T12:00:00.000Z',
      location: { latitude: 40.7128, longitude: -74.006, accuracy: 12 },
      deviceInfo: { deviceId: 'device-1', platform: 'ios', appVersion: '1.0.0' },
      notes: 'Arrived on site',
    });
    expect(parsed.location?.latitude).toBe(40.7128);
    expect(parsed.deviceInfo?.platform).toBe('ios');
  });

  it('rejects out-of-range latitude', () => {
    const result = punchInRequestSchema.safeParse({
      clientGeneratedId: 'abc',
      timestamp: '2026-04-10T12:00:00.000Z',
      location: { latitude: 200, longitude: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing clientGeneratedId', () => {
    const result = punchInRequestSchema.safeParse({
      timestamp: '2026-04-10T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('syncBatchRequestSchema', () => {
  it('accepts a batch of events', () => {
    const parsed = syncBatchRequestSchema.parse({
      deviceId: 'device-1',
      clientTimestamp: Date.now(),
      events: [
        {
          clientGeneratedId: 'evt-1',
          eventType: 'punch_in',
          timestamp: '2026-04-10T12:00:00.000Z',
          eventData: { location: { latitude: 0, longitude: 0 } },
        },
      ],
    });
    expect(parsed.events).toHaveLength(1);
  });

  it('rejects empty event arrays', () => {
    const result = syncBatchRequestSchema.safeParse({
      deviceId: 'device-1',
      clientTimestamp: Date.now(),
      events: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects batches larger than 50 events', () => {
    const events = Array.from({ length: 51 }, (_, i) => ({
      clientGeneratedId: `evt-${i}`,
      eventType: 'punch_in' as const,
      timestamp: '2026-04-10T12:00:00.000Z',
      eventData: {},
    }));
    const result = syncBatchRequestSchema.safeParse({
      deviceId: 'device-1',
      clientTimestamp: Date.now(),
      events,
    });
    expect(result.success).toBe(false);
  });
});
