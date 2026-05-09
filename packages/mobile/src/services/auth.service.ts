import * as SecureStore from 'expo-secure-store';
import { apiRequest } from './http-client';
import { useAuthStore, type AuthSession } from '../store/auth.store';

const SESSION_KEY = 'pc_session';

interface StoredSession {
  token: string;
  organizationId: string;
  userId: string;
  role: string;
}

interface LoginResponse {
  token: string;
  organizationId: string;
  userId: string;
  role: string;
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const data = await apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const session: StoredSession = {
    token: data.token,
    organizationId: data.organizationId,
    userId: data.userId,
    role: data.role,
  };
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  useAuthStore.getState().setSession(session);
  return session;
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
  useAuthStore.getState().setSession(null);
}

/**
 * Read the persisted session (if any) and hydrate the auth store. Call
 * once at app boot before deciding initial route.
 */
export async function restoreSession(): Promise<AuthSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) {
    useAuthStore.getState().setSession(null);
    return null;
  }
  try {
    const session = JSON.parse(raw) as StoredSession;
    useAuthStore.getState().setSession(session);
    return session;
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    useAuthStore.getState().setSession(null);
    return null;
  }
}
