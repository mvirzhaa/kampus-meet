// Tautan undangan https://meet.uika-bogor.ac.id/j/<kode>?k=… dibuka langsung di aplikasi.
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function InviteLink() {
  const { code, k } = useLocalSearchParams<{ code: string; k?: string }>();
  return <Redirect href={{ pathname: '/join', params: { code: code || '', ...(k ? { k } : {}) } }} />;
}
