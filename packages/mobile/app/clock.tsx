import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePunch } from '@/hooks/usePunch';
import { useSyncStore } from '@/store/sync.store';
import { useAuthStore } from '@/store/auth.store';
import { SyncIndicator } from '@/components/SyncIndicator';
import { apiRequest } from '@/services/http-client';
import { logout } from '@/services/auth.service';

interface Me {
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  organization_name: string;
}

export default function ClockScreen() {
  const router = useRouter();
  const { isOpen, loading, clockIn, clockOut, lastResult, refresh } = usePunch();
  const syncStatus = useSyncStore((s) => s.status);
  const token = useAuthStore((s) => s.token);
  const [message, setMessage] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!token) return;
    apiRequest<Me>('/auth/me', { token })
      .then(setMe)
      .catch(() => undefined);
  }, [token]);

  async function onPress() {
    setMessage(null);
    try {
      if (isOpen) {
        await clockOut();
        setMessage('Clocked out');
      } else {
        await clockIn();
        setMessage('Clocked in');
      }
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function onSignOut() {
    await logout();
    router.replace('/login');
  }

  const displayName = me
    ? [me.first_name, me.last_name].filter(Boolean).join(' ').trim() || me.email
    : null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Hi{displayName ? `, ${displayName}` : ''}</Text>
          {me && <Text style={styles.org}>{me.organization_name}</Text>}
        </View>
        <SyncIndicator status={syncStatus} />
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Current status</Text>
        <Text style={[styles.statusValue, isOpen && styles.statusValueOpen]}>
          {loading ? '…' : isOpen ? 'Clocked In' : 'Clocked Out'}
        </Text>
        <Pressable
          onPress={onPress}
          disabled={loading}
          style={({ pressed }) => [
            styles.bigButton,
            isOpen ? styles.bigButtonOut : styles.bigButtonIn,
            pressed && styles.buttonPressed,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.bigButtonText}>{isOpen ? 'Punch Out' : 'Punch In'}</Text>
          )}
        </Pressable>
        {message && <Text style={styles.message}>{message}</Text>}
        {lastResult && (
          <Text style={styles.footnote}>
            Last event at {new Date(lastResult.timestamp).toLocaleTimeString()}
          </Text>
        )}
      </View>

      <Pressable
        onPress={onSignOut}
        style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#f8fafc',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
  greeting: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  org: { marginTop: 2, color: '#64748b' },
  statusCard: {
    backgroundColor: '#fff',
    padding: 28,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  statusLabel: { fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 },
  statusValue: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#0f172a',
    marginTop: 8,
    marginBottom: 32,
  },
  statusValueOpen: { color: '#059669' },
  bigButton: {
    paddingHorizontal: 48,
    paddingVertical: 22,
    borderRadius: 14,
    minWidth: 240,
    alignItems: 'center',
  },
  bigButtonIn: { backgroundColor: '#2563eb' },
  bigButtonOut: { backgroundColor: '#dc2626' },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  bigButtonText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  message: { marginTop: 24, fontSize: 16, color: '#334155' },
  footnote: { marginTop: 6, fontSize: 12, color: '#94a3b8' },
  signOut: { marginTop: 'auto', alignItems: 'center', paddingVertical: 16 },
  signOutText: { color: '#64748b', fontSize: 14 },
});
