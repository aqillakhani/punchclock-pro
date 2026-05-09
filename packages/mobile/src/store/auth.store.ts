import { create } from 'zustand';

export interface AuthSession {
  token: string;
  organizationId: string;
  userId: string;
  role: string;
}

interface AuthState {
  token: string | null;
  organizationId: string | null;
  userId: string | null;
  role: string | null;
  /** True once restoreSession has finished — gates initial routing. */
  bootstrapped: boolean;
  setSession: (session: AuthSession | null) => void;
  setBootstrapped: (b: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  organizationId: null,
  userId: null,
  role: null,
  bootstrapped: false,
  setSession: (session) =>
    set(
      session
        ? {
            token: session.token,
            organizationId: session.organizationId,
            userId: session.userId,
            role: session.role,
          }
        : { token: null, organizationId: null, userId: null, role: null },
    ),
  setBootstrapped: (bootstrapped) => set({ bootstrapped }),
}));
