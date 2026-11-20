import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StatusBar, Text, View } from 'react-native';
import LoadingScreen from './src/components/common/LoadingScreen';
import { colors } from './src/theme/colors';
import AppNavigator from './src/navigation/AppNavigator';
import { initializeSchema } from './src/db/schema';
import { logError, logInfo } from './src/utils/logger';

export default function App() {
  const [databaseStatus, setDatabaseStatus] = useState('loading');

  useEffect(() => {
    const bootstrapDatabase = async () => {
      try {
        await initializeSchema();
        setDatabaseStatus('ready');
        logInfo('app', 'SQLite schema initialized');
      } catch (error) {
        setDatabaseStatus('error');
        logError('app', 'Failed to initialize SQLite schema', error);
      }
    };

    bootstrapDatabase();
  }, []);

  if (databaseStatus === 'loading') {
    return <LoadingScreen message="Opening your inventory…" />;
  }

  if (databaseStatus === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background }}>
        <Text accessibilityRole="alert" style={{ color: colors.textPrimary, textAlign: 'center' }}>
          Unable to open local inventory. Restart the app to retry.
        </Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar barStyle="dark-content" />
      <AppNavigator />
    </>
  );
}
