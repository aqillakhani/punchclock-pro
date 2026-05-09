'use client';

import { useRouter } from 'next/navigation';
import { clearToken } from '@/lib/auth';

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        clearToken();
        router.replace('/login');
      }}
      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:border-slate-300 hover:bg-slate-50"
    >
      Sign out
    </button>
  );
}
