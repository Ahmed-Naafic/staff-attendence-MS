/*
 * Shared UI components for the Staff app (reference: docs/design/references/staff-app/image.png).
 * They use the theme tokens only (src/theme/tokens.js), meet the 48 dp touch target and carry
 * accessibility roles and labels. Gold is the one primary action per screen.
 */
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, TOUCH, type } from '../theme/tokens';

const LOGO_MARK = require('../../assets/logo-mark.png');

export function Icon({ name, size = 22, color, family = 'ion', ...rest }) {
  const { colors } = useTheme();
  const Family = family === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <Family name={name} size={size} color={color ?? colors.fg} {...rest} />;
}

/** The EduTrack mark: the logo's emblem on its navy rounded tile (assets/logo-mark.png), legible on light and dark screens. */
export function Logo({ size = 40 }) {
  return <Image source={LOGO_MARK} accessible accessibilityRole="image" accessibilityLabel="EduTrack" style={{ width: size, height: size }} resizeMode="contain" />;
}

export function AppText({ variant = 'body', color, style, ...rest }) {
  const { colors } = useTheme();
  return <Text style={[type[variant], { color: color ?? colors.fg }, style]} maxFontSizeMultiplier={1.6} {...rest} />;
}

/** variant: primary (gold), secondary (soft blue), ghost (text), danger (text, red). */
export function Button({ title, onPress, variant = 'primary', icon, loading = false, disabled = false, style, accessibilityLabel, testID }) {
  const { colors } = useTheme();
  const off = disabled || loading;
  const look = {
    primary: { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent },
    secondary: { bg: colors.interactiveSoft, pressed: colors.border, fg: colors.interactive },
    ghost: { bg: 'transparent', pressed: colors.muted, fg: colors.interactive },
    danger: { bg: 'transparent', pressed: colors.errorSoft, fg: colors.error },
  }[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: off, busy: loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? look.pressed : look.bg, opacity: off && !loading ? 0.5 : 1 },
        variant === 'primary' && styles.buttonShadow,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={look.fg} /> : icon ? <Icon name={icon} size={20} color={look.fg} style={{ marginRight: space(2) }} /> : null}
      <AppText variant="button" color={look.fg} style={loading ? { marginLeft: space(2) } : null}>
        {title}
      </AppText>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color, family }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.muted }]}>
      <Icon name={icon} color={color ?? colors.fg} family={family} />
    </Pressable>
  );
}

/** A labelled input with a leading icon, optional show/hide for passwords, and an error. */
export function TextField({ label, icon, value, onChangeText, error, secure = false, hint, testID, ...rest }) {
  const { colors } = useTheme();
  const [hidden, setHidden] = useState(secure);
  return (
    <View style={{ marginBottom: space(3) }}>
      <View style={[styles.field, { backgroundColor: colors.surface, borderColor: error ? colors.error : colors.border }]}>
        {icon ? <Icon name={icon} size={20} color={colors.fgMuted} /> : null}
        <View style={{ flex: 1, marginLeft: icon ? space(3) : 0 }}>
          <AppText variant="caption" color={colors.fgSecondary}>
            {label}
          </AppText>
          <TextInput
            testID={testID}
            accessibilityLabel={label}
            value={value}
            onChangeText={onChangeText}
            secureTextEntry={hidden}
            placeholderTextColor={colors.fgMuted}
            style={[styles.input, { color: colors.fg }]}
            autoCapitalize="none"
            autoCorrect={false}
            {...rest}
          />
        </View>
        {secure ? <IconButton icon={hidden ? 'eye-outline' : 'eye-off-outline'} label={hidden ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`} onPress={() => setHidden((h) => !h)} color={colors.fgMuted} /> : null}
      </View>
      {error ? (
        <AppText variant="caption" color={colors.errorFg} style={{ marginTop: space(1) }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color={colors.fgMuted} style={{ marginTop: space(1) }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function Card({ children, style, tone }) {
  const { colors } = useTheme();
  const bg = tone ? colors[`${tone}Soft`] : colors.surface;
  return <View style={[styles.card, { backgroundColor: bg, borderColor: tone ? 'transparent' : colors.borderSubtle }, style]}>{children}</View>;
}

/** Status badge; always text, never color alone. tone: success, warning, error, info, neutral. */
export function Badge({ label, tone = 'neutral' }) {
  const { colors } = useTheme();
  const bg = tone === 'neutral' ? colors.muted : colors[`${tone}Soft`];
  const fg = tone === 'neutral' ? colors.fgSecondary : colors[`${tone}Fg`];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <AppText variant="caption" color={fg} style={{ fontWeight: '600' }}>
        {label}
      </AppText>
    </View>
  );
}

/** A row with an icon, a label and a value (shift, location, distance…). */
export function InfoRow({ icon, label, value, family, last = false }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.infoRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} family={family} size={22} color={colors.fgSecondary} />
      <View style={{ marginLeft: space(3), flex: 1 }}>
        <AppText variant="small" color={colors.fgSecondary}>
          {label}
        </AppText>
        <AppText variant="body">{value}</AppText>
      </View>
    </View>
  );
}

/** A label on the left and a value on the right. */
export function ValueRow({ label, value }) {
  const { colors } = useTheme();
  return (
    <View style={styles.valueRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="small" color={colors.fgSecondary}>
        {label}
      </AppText>
      <AppText variant="small" style={{ fontWeight: '600' }}>
        {value}
      </AppText>
    </View>
  );
}

/** A pressable list row with a chevron (profile, settings). */
export function ListRow({ icon, label, value, onPress, tone, family, testID }) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.error : colors.fg;
  const content = (
    <>
      <Icon name={icon} family={family} size={22} color={tone === 'danger' ? colors.error : colors.fg} />
      <View style={{ flex: 1, marginLeft: space(4) }}>
        <AppText variant="body" color={color}>
          {label}
        </AppText>
        {value ? (
          <AppText variant="small" color={colors.fgSecondary}>
            {value}
          </AppText>
        ) : null}
      </View>
      {onPress && tone !== 'danger' ? <Icon name="chevron-forward" size={18} color={colors.fgMuted} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.listRow} accessible accessibilityLabel={value ? `${label}: ${value}` : label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={value ? `${label}: ${value}` : label} onPress={onPress} style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.muted }]}>
      {content}
    </Pressable>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space(14) }} />;
}

export function LoadingView({ label = 'Loading…' }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.accent} />
      <AppText variant="small" color={colors.fgSecondary} style={{ marginTop: space(3) }}>
        {label}
      </AppText>
    </View>
  );
}

export function EmptyState({ icon = 'calendar-outline', title, message, action }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.center, { paddingVertical: space(10) }]}>
      <Icon name={icon} size={40} color={colors.fgMuted} />
      <AppText variant="cardTitle" style={{ marginTop: space(3), textAlign: 'center' }}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="small" color={colors.fgSecondary} style={{ marginTop: space(1), textAlign: 'center' }}>
          {message}
        </AppText>
      ) : null}
      {action ? <View style={{ marginTop: space(4), alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

/** An inline message: tone error, warning, info or success; optional retry. */
export function Notice({ tone = 'error', title, message, onRetry, retryLabel = 'Try again', icon }) {
  const { colors } = useTheme();
  const defaultIcon = { error: 'alert-circle', warning: 'warning', info: 'information-circle', success: 'checkmark-circle' }[tone];
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: colors[`${tone}Soft`] }]}>
      <Icon name={icon ?? defaultIcon} size={22} color={colors[tone]} />
      <View style={{ flex: 1, marginLeft: space(3) }}>
        {title ? (
          <AppText variant="cardTitle" color={colors[`${tone}Fg`]}>
            {title}
          </AppText>
        ) : null}
        {message ? (
          <AppText variant="small" color={colors[`${tone}Fg`]}>
            {message}
          </AppText>
        ) : null}
        {onRetry ? (
          <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8} style={{ marginTop: space(2), minHeight: 32, justifyContent: 'center' }}>
            <AppText variant="label" color={colors.interactive} style={{ fontWeight: '600' }}>
              {retryLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** A confirmation dialog (not a system alert). */
export function ConfirmDialog({ visible, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false, onConfirm, onCancel }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]} accessibilityViewIsModal>
          <AppText variant="section" accessibilityRole="header">
            {title}
          </AppText>
          {message ? (
            <AppText variant="body" color={colors.fgSecondary} style={{ marginTop: space(2) }}>
              {message}
            </AppText>
          ) : null}
          <View style={{ marginTop: space(5) }}>
            <Button title={confirmLabel} onPress={onConfirm} variant={destructive ? 'secondary' : 'primary'} style={destructive ? { backgroundColor: colors.errorSoft } : null} />
            {cancelLabel ? <Button title={cancelLabel} onPress={onCancel} variant="ghost" style={{ marginTop: space(2) }} /> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** A page header: back button, title and optional subtitle and right action. */
export function ScreenHeader({ title, subtitle, onBack, right }) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {onBack ? <IconButton icon="arrow-back" label="Back" onPress={onBack} /> : null}
        <AppText variant="section" accessibilityRole="header" style={{ flex: 1, marginLeft: onBack ? space(1) : 0 }}>
          {title}
        </AppText>
        {right}
      </View>
      {subtitle ? (
        <AppText variant="small" color={colors.fgSecondary} style={{ textAlign: 'center', marginTop: space(1), paddingHorizontal: space(6) }}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

/** Screen container with the page background and safe-area padding at the top. */
export function Screen({ children, edges = ['top'], style }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: colors.page, paddingTop: edges.includes('top') ? insets.top : 0, paddingBottom: edges.includes('bottom') ? insets.bottom : 0 }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: TOUCH + 4, borderRadius: radius.md, paddingHorizontal: space(5), flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  buttonShadow: { elevation: 1 },
  iconButton: { minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingLeft: space(4), paddingRight: space(1), minHeight: 60 },
  input: { fontSize: 16, paddingVertical: space(1), minHeight: 28 },
  card: { borderRadius: radius.lg, padding: space(4), borderWidth: 1 },
  badge: { borderRadius: radius.pill, paddingHorizontal: space(3), paddingVertical: 3, alignSelf: 'flex-start' },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(3) },
  valueRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space(2) },
  listRow: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: space(4), paddingVertical: space(2) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(6) },
  notice: { flexDirection: 'row', borderRadius: radius.md, padding: space(4) },
  overlay: { flex: 1, justifyContent: 'center', padding: space(6) },
  dialog: { borderRadius: radius.lg, padding: space(6) },
  header: { paddingHorizontal: space(2), paddingTop: space(2), paddingBottom: space(3) },
});
