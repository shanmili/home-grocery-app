import React, { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { isValidExpirationDate, localDateString } from '../../utils/expiration';

const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });

function startingMonth(value) {
  const date = isValidExpirationDate(value) ? new Date(value + 'T12:00:00') : new Date();
  date.setDate(1);
  return date;
}

export default function ExpirationDateField({ value, onChange }) {
  const [month, setMonth] = useState(null);
  const selected = isValidExpirationDate(value);
  const today = localDateString();
  const year = month?.getFullYear();
  const monthNumber = month?.getMonth();
  const offset = month?.getDay() ?? 0;
  const days = month ? new Date(year, monthNumber + 1, 0, 12).getDate() : 0;
  const weeks = Math.ceil((offset + days) / 7);

  function moveMonth(delta) {
    setMonth(new Date(year, monthNumber + delta, 1, 12));
  }

  function selectDate(date) {
    onChange(date);
    setMonth(null);
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Expiration date (optional)</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selected ? 'Expiration date, ' + dateFormat.format(new Date(value + 'T12:00:00')) : 'Choose expiration date'}
          accessibilityState={{ expanded: Boolean(month) }}
          style={styles.dateButton}
          onPress={() => {
            Keyboard.dismiss();
            setMonth((open) => open ? null : startingMonth(value));
          }}
        >
          <Text style={styles.label}>
            {selected ? dateFormat.format(new Date(value + 'T12:00:00')) : 'Choose a date'}
          </Text>
        </Pressable>
        {value ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear expiration date" style={styles.control} onPress={() => selectDate('')}>
            <Text style={styles.accent}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {month ? (
        <View style={styles.calendar}>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" style={styles.control} onPress={() => moveMonth(-1)}>
              <Text style={styles.arrow}>‹</Text>
            </Pressable>
            <Text accessibilityRole="header" style={[styles.label, styles.month]}>{monthFormat.format(month)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" style={styles.control} onPress={() => moveMonth(1)}>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          </View>

          <View style={styles.actions}>
            {weekdays.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}
          </View>

          {Array.from({ length: weeks }, (_, week) => (
            <View key={week} style={styles.actions}>
              {weekdays.map((weekday, column) => {
                const day = week * 7 + column - offset + 1;
                if (day < 1 || day > days) return <View key={weekday} style={styles.day} />;

                const date = new Date(year, monthNumber, day, 12);
                const dateString = localDateString(date);
                const isSelected = dateString === value;
                return (
                  <Pressable
                    key={weekday}
                    accessibilityRole="button"
                    accessibilityLabel={dayFormat.format(date)}
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.day, dateString === today && styles.today, isSelected && styles.selected]}
                    onPress={() => selectDate(dateString)}
                  >
                    <Text style={[styles.label, isSelected && styles.selectedLabel]}>{day}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center' },
  label: { ...typography.body, color: colors.textPrimary },
  dateButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.input,
  },
  control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  accent: { ...typography.caption, color: colors.primaryDark, fontWeight: '700' },
  arrow: { fontSize: 26, color: colors.primaryDark },
  calendar: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.xs, backgroundColor: colors.surface },
  month: { flex: 1, textAlign: 'center', fontWeight: '700' },
  weekday: { ...typography.caption, flex: 1, textAlign: 'center', color: colors.textSecondary, paddingVertical: spacing.xs },
  day: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  today: { backgroundColor: colors.surfaceAlt },
  selected: { backgroundColor: colors.primaryDark },
  selectedLabel: { color: '#FFFFFF' },
});
