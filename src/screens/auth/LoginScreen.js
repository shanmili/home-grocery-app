import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import LoadingScreen from '../../components/common/LoadingScreen';
import ScreenShell from '../../components/common/ScreenShell';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { useSession } from '../../state/sessionStore';

export default function LoginScreen() {
  const { isConfigured, signIn } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (submitting || !isConfigured) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await signIn(username, password);
      setPassword('');
    } catch (signInError) {
      setError(signInError.message || 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitting) return <LoadingScreen message="Signing in…" />;

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        persistentScrollbar
        indicatorStyle="black"
      >
        <Text style={styles.title}>Home Grocery Inventory</Text>
        <Text style={styles.subtitle}>Sign in with your family account.</Text>
        {!isConfigured ? (
          <Text accessibilityRole="alert" style={styles.error}>
            Supabase setup is required before you can sign in.
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel="Username"
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          style={styles.input}
          editable={isConfigured}
        />
        <TextInput
          accessibilityLabel="Password"
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          secureTextEntry
          style={styles.input}
          editable={isConfigured}
          onSubmitEditing={submit}
        />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={!isConfigured}
          style={[styles.button, !isConfigured && styles.disabled]}
          onPress={submit}
        >
          <Text style={styles.buttonLabel}>Sign in</Text>
        </Pressable>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primaryDark,
    borderRadius: 14,
    padding: spacing.md,
  },
  disabled: { opacity: 0.55 },
  buttonLabel: { ...typography.body, color: '#FFFFFF', fontWeight: '700' },
  error: { ...typography.body, color: colors.danger },
});
