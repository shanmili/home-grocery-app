import React from 'react';
import { StyleSheet, View } from 'react-native';

// Each segment connects two points on a 22 × 22 icon grid.
const outlines = {
  Notifications: [[3, 16, 19, 16], [3, 16, 6, 13], [6, 13, 6, 8], [6, 8, 8, 5],
    [8, 5, 11, 4], [11, 4, 14, 5], [14, 5, 16, 8], [16, 8, 16, 13], [16, 13, 19, 16], [9, 19, 13, 19]],
  Dashboard: [[3, 10, 11, 3], [11, 3, 19, 10], [5, 9, 5, 19], [17, 9, 17, 19],
    [5, 19, 17, 19], [9, 19, 9, 14], [9, 14, 13, 14], [13, 14, 13, 19]],
  Inventory: [[3, 6, 19, 6], [3, 6, 3, 18], [19, 6, 19, 18], [3, 18, 19, 18],
    [3, 10, 19, 10], [9, 13, 13, 13]],
  Shopping: [[2, 4, 5, 4], [5, 4, 8, 15], [7, 13, 17, 13], [17, 13, 20, 7], [6, 7, 20, 7]],
  History: [[11, 6, 11, 11], [11, 11, 14, 13]],
  PantryQuest: [[11, 2, 13.4, 7.8], [13.4, 7.8, 20, 8.5], [20, 8.5, 15, 12.8],
    [15, 12.8, 16.5, 19], [16.5, 19, 11, 15.7], [11, 15.7, 5.5, 19],
    [5.5, 19, 7, 12.8], [7, 12.8, 2, 8.5], [2, 8.5, 8.6, 7.8], [8.6, 7.8, 11, 2]],
  Settings: [[3, 5, 19, 5], [3, 11, 19, 11], [3, 17, 19, 17],
    [7, 3, 7, 7], [15, 9, 15, 13], [10, 15, 10, 19]],
};

export default function TabIcon({ name, color }) {
  const segments = outlines[name];
  if (!segments) return null;

  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.icon}>
      {name === 'History' ? <View style={[styles.clock, { borderColor: color }]} /> : null}
      {segments.map(([x1, y1, x2, y2], index) => {
        const width = Math.hypot(x2 - x1, y2 - y1);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        return (
          <View key={index} style={[styles.line, {
            width,
            left: (x1 + x2 - width) / 2,
            top: (y1 + y2 - 1.6) / 2,
            transform: [{ rotate: angle + 'rad' }],
            backgroundColor: color,
          }]} />
        );
      })}
      {name === 'Shopping' ? (
        <>
          <View style={[styles.wheel, { left: 8, backgroundColor: color }]} />
          <View style={[styles.wheel, { left: 15, backgroundColor: color }]} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { width: 22, height: 22 },
  line: { position: 'absolute', height: 1.6, borderRadius: 1 },
  clock: { position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderWidth: 1.6, borderRadius: 8 },
  wheel: { position: 'absolute', top: 16, width: 3, height: 3, borderRadius: 2 },
});
