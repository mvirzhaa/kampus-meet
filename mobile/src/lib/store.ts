// Penyimpanan kecil (pengaturan & alamat server) di perangkat.
import * as SecureStore from 'expo-secure-store';

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try { const v = await SecureStore.getItemAsync(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; }
  catch { return fallback; }
}
export async function setJSON(key: string, value: unknown) {
  try { await SecureStore.setItemAsync(key, JSON.stringify(value)); } catch { /* abaikan */ }
}
export async function getStr(key: string): Promise<string | null> {
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}
export async function setStr(key: string, value: string | null) {
  try { if (value == null) await SecureStore.deleteItemAsync(key); else await SecureStore.setItemAsync(key, value); } catch { /* abaikan */ }
}
