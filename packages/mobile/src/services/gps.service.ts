import * as Location from 'expo-location';

export interface LocationReading {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
}

let lastKnown: LocationReading | null = null;

/**
 * Request a one-shot high-accuracy location with a strict timeout.
 * Falls back to the last known reading so a weak GPS never blocks a
 * punch. Caller can continue without GPS if nothing is available.
 */
export async function getCriticalLocation(timeoutMs = 1500): Promise<LocationReading | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return lastKnown;

  const race = new Promise<LocationReading | null>((resolve) => {
    const t = setTimeout(() => resolve(lastKnown), timeoutMs);
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      .then((pos) => {
        clearTimeout(t);
        const reading: LocationReading = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        lastKnown = reading;
        resolve(reading);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(lastKnown);
      });
  });
  return race;
}
