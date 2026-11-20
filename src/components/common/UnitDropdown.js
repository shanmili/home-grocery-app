import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';

const units = ['sachet', 'ml', 'kg', 'g', 'pc/s', 'pack'];

export default function UnitDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const options = value && !units.includes(value) ? [...units, value] : units;
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={styles.field} onPress={() => setOpen(!open)}>
        <Text style={styles.label}>Unit</Text>
        <Text style={styles.label}>{value || 'Select unit'} {open ? '\u25B4' : '\u25BE'}</Text>
      </Pressable>
      {open ? options.map((unit) => (
        <Pressable key={unit} accessibilityRole="button" accessibilityState={{ selected: value === unit }}
          style={styles.field} onPress={() => { onChange(unit); setOpen(false); }}>
          <Text style={styles.label}>{unit}</Text>
        </Pressable>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, backgroundColor: colors.input,
  },
  label: { color: colors.textPrimary },
});
