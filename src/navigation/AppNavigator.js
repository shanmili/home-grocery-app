import React from 'react';
import LoadingScreen from '../components/common/LoadingScreen';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/auth/LoginScreen';
import InventoryListScreen from '../screens/inventory/InventoryListScreen';
import { SyncProvider } from '../state/grocerySyncStore';
import { NotificationsScreen } from '../screens/dashboard/DashboardScreen';
import NotificationBell from './NotificationBell';
import MainTabs from './MainTabs';
import { colors } from '../theme/colors';
import { SessionProvider, useSession } from '../state/sessionStore';

const Stack = createNativeStackNavigator();

const appTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.primary,
  },
};

export default function AppNavigator() {
  return (
    <SessionProvider>
      <SyncProvider>
        <RootNavigator />
      </SyncProvider>
    </SessionProvider>
  );
}

function RootNavigator() {
  const { isAuthenticated, restoringSession, currentUser } = useSession();

  if (restoringSession) {
    return <LoadingScreen message="Restoring your session…" />;
  }

  return (
    <NavigationContainer theme={appTheme}>
      <Stack.Navigator
        screenOptions={({ navigation, route }) => ({
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
          headerRight: isAuthenticated && route.name !== 'Notifications' ? () => <NotificationBell navigation={navigation} /> : undefined,
        })}
      >
        {isAuthenticated ? (
          <Stack.Group navigationKey={currentUser.id}>
            <Stack.Screen
              name="MainTabs"
              component={MainTabs}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="LowStock"
              component={InventoryListScreen}
              initialParams={{ stockFilter: 'low' }}
              options={{ title: 'Low stock' }}
            />
            <Stack.Screen
              name="OutOfStock"
              component={InventoryListScreen}
              initialParams={{ stockFilter: 'out' }}
              options={{ title: 'Out of stock' }}
            />
            <Stack.Screen
              name="InventoryCategory"
              component={InventoryListScreen}
              options={({ route }) => ({ title: route.params.category })}
            />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
            />
          </Stack.Group>
        ) : (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ title: 'Family Sign In' }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
