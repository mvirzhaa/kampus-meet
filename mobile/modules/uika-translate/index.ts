import { requireOptionalNativeModule } from 'expo-modules-core';

/** Modul native terjemahan di perangkat (Android, Google ML Kit). null bila tidak tersedia (mis. Expo Go / iOS). */
type Native = {
  prepare(from: string, to: string, wifiOnly: boolean): Promise<boolean>;
  isReady(from: string, to: string): Promise<boolean>;
  translate(text: string, from: string, to: string): Promise<string>;
};
const native = requireOptionalNativeModule<Native>('UikaTranslate');
export default native;
