import type { ApiResponse } from '@punchclock/shared';

const BASE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE_URL) ??
  'http://localhost:4000';

function getToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)pc_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

const PREVIEW_AS_KEY = 'pc_preview_as_user_id';

export function getPreviewAsUserId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(PREVIEW_AS_KEY);
}

export function setPreviewAsUserId(id: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (id) localStorage.setItem(PREVIEW_AS_KEY, id);
  else localStorage.removeItem(PREVIEW_AS_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const previewAs = getPreviewAsUserId();
  if (previewAs) headers.set('X-Preview-As-User-Id', previewAs);

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: 'include' });
  const payload = (await res.json()) as ApiResponse<T>;
  if (!payload.success) {
    const err = new Error(payload.error.message);
    (err as Error & { code?: string }).code = payload.error.code;
    throw err;
  }
  return payload.data;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
