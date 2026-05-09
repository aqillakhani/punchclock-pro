import * as Haptics from 'expo-haptics';
import { v4 as uuid } from 'uuid';
import { apiRequest } from './http-client';
import { getCriticalLocation } from './gps.service';
import { tryGetSyncService } from './sync.service';

export interface LocalPunchResult {
  clientGeneratedId: string;
  type: 'punch_in' | 'punch_out';
  timestamp: string;
  synced: boolean;
}

interface PunchPayload {
  clientGeneratedId: string;
  timestamp: string;
  location?: { latitude: number; longitude: number; accuracy?: number };
  deviceInfo: { deviceId: string; platform: 'ios' | 'android' };
}

async function tryServerPunch(
  type: 'punch_in' | 'punch_out',
  payload: PunchPayload,
  token: string | null,
): Promise<{ ok: true; serverId: string } | { ok: false }> {
  const path = type === 'punch_in' ? '/api/v1/time-tracking/punch-in' : '/api/v1/time-tracking/punch-out';
  try {
    const res = await apiRequest<{ entry: { id: string } }>(path, {
      method: 'POST',
      token,
      timeoutMs: 4000,
      body: payload,
    });
    return { ok: true, serverId: res?.entry?.id ?? '' };
  } catch {
    return { ok: false };
  }
}

/**
 * Perform an offline-first punch. The UI can update the moment this
 * returns — the network round-trip is best-effort. On failure the
 * event is enqueued in the persistent sync queue (WatermelonDB at
 * runtime, in-memory in tests) and retried by the auto-sync loop.
 */
export async function performPunch(
  type: 'punch_in' | 'punch_out',
  token: string | null,
): Promise<LocalPunchResult> {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);

  const clientGeneratedId = uuid();
  const timestamp = new Date().toISOString();
  const location = await getCriticalLocation();

  const payload: PunchPayload = {
    clientGeneratedId,
    timestamp,
    location: location
      ? { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy ?? undefined }
      : undefined,
    deviceInfo: { deviceId: 'expo-client', platform: 'ios' },
  };

  const result = await tryServerPunch(type, payload, token);

  if (!result.ok) {
    const sync = tryGetSyncService();
    if (sync) {
      await sync.enqueue({
        clientGeneratedId,
        operationType: type === 'punch_in' ? 'create_punch_in' : 'create_punch_out',
        priority: 1,
        payload,
      });
    }
  }

  return { clientGeneratedId, type, timestamp, synced: result.ok };
}
