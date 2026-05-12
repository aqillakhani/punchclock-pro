import Constants from 'expo-constants';

function resolveBaseUrl(): string {
  const explicit =
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
    process.env.EXPO_PUBLIC_API_BASE_URL;
  if (explicit) return explicit;

  // In Expo Go / dev client the Metro bundler URL contains the host
  // laptop's LAN IP — reuse it so the phone can reach the API at :4000
  // without any manual config.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:4000`;
    }
  }
  return 'http://localhost:4000';
}

const BASE_URL = resolveBaseUrl();

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, timeoutMs = 8000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = (await res.json()) as
      | { success: true; data: T }
      | { success: false; error: { code: string; message: string } };
    if (!payload.success) {
      const err = new Error(payload.error.message);
      (err as Error & { code?: string }).code = payload.error.code;
      throw err;
    }
    return payload.data;
  } finally {
    clearTimeout(timer);
  }
}
