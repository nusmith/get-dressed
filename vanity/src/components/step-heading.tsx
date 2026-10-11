import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

type StepHeadingProps = {
  step: number;
  title: string;
  /** Short muted label after the title, e.g. "Coming soon". */
  note?: string;
  disabled?: boolean;
};

export function StepHeading({ step, title, note, disabled }: StepHeadingProps) {
  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <View style={styles.badge}>
        <ThemedText style={styles.badgeText}>{step}</ThemedText>
      </View>
      <ThemedText style={styles.title}>{title}</ThemedText>
      {note ? <ThemedText style={styles.note}>{note}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    maxWidth: 360,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  disabled: {
    opacity: 0.6,
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  title: {
    fontWeight: '600',
  },
  note: {
    fontSize: 12,
    lineHeight: 16,
    color: '#9ca3af',
  },
});
