import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { initDatabase } from '@/db/database';
import { restoreSession } from '@/services/auth.service';
import { useAuthStore } from '@/store/auth.store';
import { useSyncStore } from '@/store/sync.store';
import { bootstrapSync } from '@/services/sync.bootstrap';
import { startAutoSync } from '@/services/sync.service';

export default function RootLayout() {
  const setStatus = useSyncStore((s) => s.setStatus);
  const token = useAuthStore((s) => s.token);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    let stopAuto: (() => void) | undefined;

    Promise.all([
      restoreSession().finally(() => useAuthStore.getState().setBootstrapped(true)),
      initDatabase().then((db) => {
        bootstrapSync(db, () => useAuthStore.getState().token);
        stopAuto = startAutoSync();
      }),
    ]).catch(() => setStatus('error'));

    return () => {
      if (stopAuto) stopAuto();
    };
  }, [setStatus]);

  useEffect(() => {
    if (!bootstrapped) return;
    const onLogin = segments[0] === 'login';
    if (!token && !onLogin) {
      router.replace('/login');
    } else if (token && onLogin) {
      router.replace('/clock');
    }
  }, [bootstrapped, token, segments, router]);

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="login" options={{ title: 'Sign in', headerShown: false }} />
        <Stack.Screen name="index" options={{ title: 'PunchClock Pro' }} />
        <Stack.Screen name="clock" options={{ title: 'Clock In/Out' }} />
      </Stack>
    </>
  );
}
