import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';

export default function CollapsibleGroup({ title, count, children }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <Text style={styles.title}>{title} ({count})</Text>
        <Text accessible={false} style={styles.title}>{expanded ? '\u2212' : '+'}</Text>
      </Pressable>
      {expanded ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.sm, backgroundColor: colors.surfaceAlt },
  title: { ...typography.body, color: colors.primaryDark, fontWeight: '700', flexShrink: 1 },
  body: { padding: spacing.sm, gap: spacing.sm },
});
