import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>PunchClock Pro</Text>
      <Text style={styles.subtitle}>
        Your time clock that works everywhere — even offline.
      </Text>
      <Link href="/clock" style={styles.button}>
        Go to clock
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#eef6ff' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#1e3a8a' },
  subtitle: { marginTop: 12, marginBottom: 32, fontSize: 16, color: '#334155', textAlign: 'center' },
  button: { backgroundColor: '#2563eb', color: '#fff', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, fontSize: 18, overflow: 'hidden' },
});
