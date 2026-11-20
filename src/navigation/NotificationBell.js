import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import TabIcon from '../components/common/TabIcon';
import { colors } from '../theme/colors';

export default function NotificationBell({ navigation }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Notifications"
      onPress={() => navigation.navigate('Notifications')}
      style={styles.button}
    >
      <TabIcon name="Notifications" color={colors.primaryDark} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
