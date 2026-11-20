import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import LoadingScreen from '../../components/common/LoadingScreen';
import ScreenShell from '../../components/common/ScreenShell';
import SectionCard from '../../components/common/SectionCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { useGrocerySync } from '../../state/grocerySyncStore';
import { useSession } from '../../state/sessionStore';

export default function SettingsScreen() {
  const { currentUser, signOut } = useSession();
  const sync = useGrocerySync();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      Alert.alert('Could not sign out', 'Check your connection and try again.');
    } finally {
      setSigningOut(false);
    }
  }

  function confirmPublish() {
    Alert.alert(
      'Publish this inventory?',
      'This phone’s active products and open manual shopping items will become the starting inventory for the family. Other phones will keep a local backup of their previous inventory.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Publish inventory', onPress: () => { void sync.syncNow(true); } },
      ]
    );
  }

  const syncText = {
    checking: 'Checking shared inventory.',
    unpublished: 'An admin needs to publish the starting inventory.',
    ready: sync.pendingCount ? `${sync.pendingCount} changes waiting to sync.` : sync.conflicts?.length ? 'Shared inventory refreshed. Review the conflicts below.' : 'Shared inventory is up to date.',
    offline: 'Offline. Changes are saved on this phone.',
    error: sync.message,
  }[sync.state];

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={styles.screen}
        showsVerticalScrollIndicator
        persistentScrollbar
        indicatorStyle="black"
      >
        <SectionCard title="Current Account">
          {signingOut ? <LoadingScreen compact message="Signing out…" /> : null}
          <Text style={styles.name}>{currentUser.displayName}</Text>
          <Text style={styles.meta}>{currentUser.username}</Text>
          <Text style={styles.meta}>Role: {currentUser.role}</Text>
          <Pressable
            accessibilityRole="button"
            style={styles.signOutButton}
            disabled={signingOut}
            onPress={handleSignOut}
          >
            <Text style={styles.signOutLabel}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
          </Pressable>
        </SectionCard>

        <SectionCard title="Family sync">
          {sync.syncing || sync.state === 'checking' ? (
            <LoadingScreen compact message="Checking family sync..." />
          ) : (
            <Text style={styles.meta} accessibilityLiveRegion="polite">{syncText}</Text>
          )}
          {sync.pendingError && sync.pendingCount > 0 ? (
            <Text style={styles.conflict}>{sync.pendingError}</Text>
          ) : null}
          {sync.conflicts?.map(({ entityId, label, message }, index) => (
            <Text key={entityId + '-' + index} style={styles.conflict}>
              {label}: {message}
            </Text>
          ))}
          <Pressable
            accessibilityRole="button"
            style={styles.signOutButton}
            disabled={sync.syncing}
            onPress={() => { void sync.syncNow(); }}
          >
            <Text style={styles.signOutLabel}>Sync now</Text>
          </Pressable>
          {currentUser.role === 'ADMIN' && sync.state === 'unpublished' ? (
            <Pressable
              accessibilityRole="button"
              style={styles.signOutButton}
              disabled={sync.syncing}
              onPress={confirmPublish}
            >
              <Text style={styles.signOutLabel}>Publish this device’s inventory</Text>
            </Pressable>
          ) : null}
        </SectionCard>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg },
  name: { ...typography.heading, color: colors.textPrimary },
  conflict: { ...typography.caption, color: colors.danger },
  meta: { ...typography.caption, color: colors.textSecondary },
  signOutButton: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  signOutLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
});
