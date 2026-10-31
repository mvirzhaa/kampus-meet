// Komponen dasar bergaya UIKA Meet: teks, tombol besar ramah jempol, kartu, input, bottom sheet.
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput,
  View, type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, R } from '@/lib/theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

type TProps = TextProps & { w?: 'regular' | 'semibold' | 'bold' | 'extrabold'; size?: number; color?: string };
export function T({ w = 'regular', size = 15, color = C.text, style, ...rest }: TProps) {
  return <Text {...rest} style={[{ fontFamily: F[w], fontSize: size, color }, style]} />;
}

type BtnProps = PressableProps & {
  title: string; icon?: IconName; variant?: 'primary' | 'ghost' | 'danger' | 'light' | 'gold';
  loading?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
};
export function Button({ title, icon, variant = 'primary', loading, style, small, disabled, ...rest }: BtnProps) {
  const v = BTN[variant];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} {...rest} disabled={disabled || loading}
      style={({ pressed }) => [styles.btn, small && styles.btnSm, { backgroundColor: v.bg, borderColor: v.border }, (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 }, style]}>
      {loading ? <ActivityIndicator color={v.fg} /> : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 17 : 20} color={v.fg} /> : null}
          <T w="bold" size={small ? 14 : 16} color={v.fg}>{title}</T>
        </>
      )}
    </Pressable>
  );
}
const BTN = {
  primary: { bg: C.primary, fg: '#fff', border: C.primary },
  ghost: { bg: '#fff', fg: C.primaryDark, border: C.border },
  danger: { bg: C.danger, fg: '#fff', border: C.danger },
  light: { bg: 'rgba(255,255,255,0.12)', fg: '#fff', border: 'rgba(255,255,255,0.18)' },
  gold: { bg: C.gold, fg: C.deep, border: C.gold },
};

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({ label, style, ...rest }: TextInputProps & { label?: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <T w="semibold" size={14} color={C.muted}>{label}</T> : null}
      <TextInput placeholderTextColor="#90A49C" {...rest} style={[styles.input, style]} />
    </View>
  );
}

export function Row({ icon, label, value, onPress, right, danger }: { icon?: IconName; label: string; value?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#F4F9F7' }]}>
      {icon ? <Ionicons name={icon} size={21} color={danger ? C.danger : C.primary} /> : null}
      <View style={{ flex: 1 }}>
        <T w="semibold" size={15.5} color={danger ? C.danger : C.text}>{label}</T>
        {value ? <T size={13.5} color={C.muted}>{value}</T> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color="#9AB0A8" /> : null)}
    </Pressable>
  );
}

export function SwitchRow({ label, desc, value, onChange, dark }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void; dark?: boolean }) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <T w="semibold" size={15} color={dark ? C.callText : C.text}>{label}</T>
        {desc ? <T size={13} color={dark ? C.callMuted : C.muted}>{desc}</T> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: '#34D399', false: dark ? '#3A4A44' : '#CBD8D2' }} thumbColor={value ? C.primary : '#f4f4f4'} />
    </View>
  );
}

/** Pilihan bersegmen (mis. bahasa). */
export function Segmented<V extends string>({ options, value, onChange, dark }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; dark?: boolean }) {
  return (
    <View style={[styles.seg, dark && { backgroundColor: '#1D2C27' }]}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segItem, on && { backgroundColor: dark ? C.primary : '#fff' }]}>
            <T w={on ? 'bold' : 'semibold'} size={14} color={on ? (dark ? '#fff' : C.primaryDark) : dark ? C.callMuted : C.muted}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bottom sheet sederhana (geser dari bawah), gelap untuk ruang meeting. */
export function Sheet({ visible, onClose, title, children, dark, scroll = true, full }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; dark?: boolean; scroll?: boolean; full?: boolean }) {
  const insets = useSafeAreaInsets();
  const bg = dark ? '#111D19' : '#fff';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Tutup" />
        <View style={[styles.sheet, { backgroundColor: bg, paddingBottom: insets.bottom + 8 }, full && { height: '88%' }]}>
          <View style={styles.grab} />
          <View style={styles.sheetHead}>
            <T w="bold" size={18} color={dark ? '#fff' : C.text} style={{ flex: 1 }}>{title}</T>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Tutup"><Ionicons name="close" size={26} color={dark ? C.callMuted : C.muted} /></Pressable>
          </View>
          {scroll ? <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, gap: 14 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
            : <View style={{ flex: 1 }}>{children}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Avatar({ name, size = 44, dark }: { name: string; size?: number; dark?: boolean }) {
  const ini = (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() || '').join('') || '?';
  const hue = [...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
  const bgs = dark ? ['#0F766E', '#047857', '#065F46', '#0E7490'] : ['#D1FAE5', '#CCFBF1', '#FEF3C7', '#E0F2FE'];
  const fgs = dark ? ['#fff', '#fff', '#fff', '#fff'] : ['#065F46', '#115E59', '#92400E', '#075985'];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bgs[hue], alignItems: 'center', justifyContent: 'center' }}>
      <T w="bold" size={size * 0.38} color={fgs[hue]}>{ini}</T>
    </View>
  );
}

export function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ alignItems: 'center', padding: 30, gap: 10 }}>
      <Ionicons name={icon} size={40} color="#A7C1B7" />
      <T color={C.muted} style={{ textAlign: 'center' }}>{text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 52, borderRadius: R.md, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1 },
  btnSm: { minHeight: 40, paddingHorizontal: 14, borderRadius: 11 },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 18, borderWidth: 1, borderColor: C.border },
  input: { minHeight: 52, borderRadius: R.md, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#fff', paddingHorizontal: 16, fontFamily: F.regular, fontSize: 16, color: C.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  seg: { flexDirection: 'row', backgroundColor: '#E6EFEB', borderRadius: 12, padding: 4, gap: 4 },
  segItem: { flex: 1, minHeight: 42, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '88%' },
  grab: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(128,128,128,0.4)', marginTop: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12 },
});
