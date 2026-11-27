/*
 * The shared dashboard layout of every workspace (docs/mobile/workspaces.md → Dashboards): a fixed
 * order of a freshness line (live, or saved with its time and an Offline mark), stat tiles and quick
 * actions. Skeletons show while the first answer loads. Saved financial figures are labelled as not
 * live and not confirmed.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { updatedText } from '../lib/useCachedResource';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { AppText, Icon, Notice } from './ui';

/** The freshness line: "Live · Updated 10:42", or the saved-copy warning. */
export function Freshness({ resource, financial = false }) {
  const { colors } = useTheme();
  if (!resource.fetchedAt) return null;
  if (resource.saved) {
    return (
      <Notice
        tone="warning"
        icon="cloud-offline-outline"
        title={`Offline · ${updatedText(resource.fetchedAt)}`}
        message={financial ? 'Saved figures, not live and not confirmed. Payments and balances may have changed.' : 'Saved figures. Pull down to update when you’re back online.'}
      />
    );
  }
  return (
    <View style={styles.fresh} testID="dashboard-live">
      <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
      <AppText variant="caption" color={colors.fgSecondary}>
        {`Live · ${updatedText(resource.fetchedAt)}`}
      </AppText>
    </View>
  );
}

/** A grid of stat tiles: [{ key, label, value, icon, tone }]. */
export function StatGrid({ items }) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {items.map((s) => (
        <View key={s.key} testID={`stat-${s.key}`} style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Icon name={s.icon ?? 'stats-chart-outline'} size={18} color={s.tone ? colors[s.tone] : colors.accent} />
          <AppText variant="section" style={{ marginTop: space(2), fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>
            {s.value}
          </AppText>
          <AppText variant="caption" color={colors.fgSecondary} numberOfLines={2}>
            {s.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** Quick actions: [{ key, label, icon, onPress }]. */
export function QuickActions({ items }) {
  const { colors } = useTheme();
  if (!items.length) return null;
  return (
    <View style={styles.grid}>
      {items.map((a) => (
        <Pressable
          key={a.key}
          testID={`action-${a.key}`}
          accessibilityRole="button"
          onPress={a.onPress}
          style={({ pressed }) => [styles.action, { backgroundColor: pressed ? colors.muted : colors.surface, borderColor: colors.border }]}
        >
          <Icon name={a.icon} size={22} color={colors.accent} />
          <AppText variant="small" style={{ marginTop: space(1), fontWeight: '600', textAlign: 'center' }}>
            {a.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

/** Placeholder tiles while the first answer loads. */
export function SkeletonGrid({ count = 4 }) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.tile, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <View style={[styles.bar, { width: 24, backgroundColor: colors.border }]} />
          <View style={[styles.bar, { width: '60%', height: 18, marginTop: space(2), backgroundColor: colors.border }]} />
          <View style={[styles.bar, { width: '80%', marginTop: space(1), backgroundColor: colors.border }]} />
        </View>
      ))}
    </View>
  );
}

/** A section title on a dashboard. */
export function SectionTitle({ children }) {
  const { colors } = useTheme();
  return (
    <AppText variant="label" color={colors.fgSecondary} style={{ marginTop: space(5), marginBottom: space(2) }}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  fresh: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  tile: { flexBasis: '48%', flexGrow: 1, borderWidth: 1, borderRadius: radius.md, padding: space(3), minHeight: 96 },
  action: { flexBasis: '31%', flexGrow: 1, borderWidth: 1, borderRadius: radius.md, padding: space(3), alignItems: 'center', minHeight: 84, justifyContent: 'center' },
  bar: { height: 10, borderRadius: 4 },
});
