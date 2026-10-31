import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const { me } = useAuth();
  return <Redirect href={me?.user ? '/(tabs)' : '/welcome'} />;
}
