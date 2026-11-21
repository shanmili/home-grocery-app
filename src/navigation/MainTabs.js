import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import InventoryListScreen from '../screens/inventory/InventoryListScreen';
import ShoppingListScreen from '../screens/shopping/ShoppingListScreen';
import ActivityHistoryScreen from '../screens/history/ActivityHistoryScreen';
import PantryQuestScreen from '../screens/quest/PantryQuestScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import NotificationBell from './NotificationBell';
import TabIcon from '../components/common/TabIcon';
import { colors } from '../theme/colors';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName="Dashboard"
      screenOptions={({ navigation, route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        headerRight: () => <NotificationBell navigation={navigation} />,
        tabBarLabelPosition: 'below-icon',
        tabBarHideOnKeyboard: true,
        tabBarIcon: ({ color }) => <TabIcon name={route.name} color={color} />,
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(8, insets.bottom),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.3,
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Inventory" component={InventoryListScreen} />
      <Tab.Screen name="Shopping" component={ShoppingListScreen} />
      <Tab.Screen name="History" component={ActivityHistoryScreen} />
      <Tab.Screen name="PantryQuest" component={PantryQuestScreen} options={{ title: 'Pantry Quest', tabBarLabel: 'Quest' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
