import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';

export default function StatCard({ label, value, tone, onPress }) {
  const attentionColor = Number(value) > 0 ? colors[tone] : undefined;

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, attentionColor && { color: attentionColor }]}>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 92,
    borderRadius: 16,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  pressed: { backgroundColor: colors.surfaceAlt },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  value: {
    ...typography.title,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
});
