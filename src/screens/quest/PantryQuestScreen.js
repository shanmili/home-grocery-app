import React, { useCallback, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import LoadingScreen from '../../components/common/LoadingScreen';
import ScreenShell from '../../components/common/ScreenShell';
import SectionCard from '../../components/common/SectionCard';
import { useSession } from '../../state/sessionStore';
import { useGrocerySync } from '../../state/grocerySyncStore';
import { claimQuestPoints, getPantryQuest } from '../../services/pantryQuest';
import { formatRedemptionReference } from '../../utils/redemptionReference';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';

const refreshIntervalMs = 15000;
const pointsPerPeso = 10000;
const pointFormat = new Intl.NumberFormat('en-PH');

const actionLabels = {
  STOCK_USED: 'Used stock',
  SHOPPING_ITEM_ADDED: 'Added a shopping item',
  STOCK_RESTOCKED: 'Restocked a product',
};

const metricLabels = {
  xp: 'XP',
  contributions: 'contributions',
  streak: 'consecutive days',
  STOCK_USED: 'stock deductions',
  SHOPPING_ITEM_ADDED: 'shopping items added',
  STOCK_RESTOCKED: 'products restocked',
};

export default function PantryQuestScreen() {
  const { currentUser } = useSession();
  const { revision, syncNow, state: syncState } = useGrocerySync();
  const [result, setResult] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const claimInFlight = useRef(false);
  const claimRevision = useRef(0);

  async function submitClaim(pesos) {
    if (claimInFlight.current) return;
    claimInFlight.current = true;
    claimRevision.current += 1;
    setClaiming(true);
    try {
      const claim = await claimQuestPoints(currentUser.id, pesos);
      const reference = formatRedemptionReference(claim.redeemed_at);
      Alert.alert(
        'Claim confirmed',
        [currentUser.displayName + ' · ₱' + pointFormat.format(claim.pesos),
          reference ? 'Reference: ' + reference : null,
          'Claim ID: ' + claim.request_id].filter(Boolean).join('\n')
      );
      const refreshed = await getPantryQuest(currentUser.id).catch(() => null);
      if (refreshed) setResult(refreshed);
    } catch (error) {
      const refreshed = await getPantryQuest(currentUser.id).catch(() => null);
      if (refreshed) setResult(refreshed);
      Alert.alert('Could not confirm claim', error.message || 'Try again when connected.');
    } finally {
      claimInFlight.current = false;
      setClaiming(false);
    }
  }
  useFocusEffect(useCallback(() => {
    void syncNow();
  }, [syncNow]));

  useFocusEffect(useCallback(() => {
    let active = true;
    let refreshing = false;

    async function refresh() {
      if (refreshing || claimInFlight.current || AppState.currentState === 'background'
        || AppState.currentState === 'inactive') return;
      refreshing = true;
      const currentClaim = claimRevision.current;
      try {
        const data = await getPantryQuest(currentUser.id);
        if (active && currentClaim === claimRevision.current) setResult(data);
      } catch {
        if (active && currentClaim === claimRevision.current) {
          setResult((previous) => previous ?? { message: 'Could not load Pantry Quest.' });
        }
      } finally {
        refreshing = false;
      }
    }

    void refresh();
    const timer = setInterval(refresh, refreshIntervalMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [currentUser.id, revision]));

  const profile = result?.profile;
  const rewardPoints = Math.max(0, profile?.rewardPoints ?? 0);
  const wholePesos = Math.floor(rewardPoints / pointsPerPeso);
  const pointsToNextPeso = pointsPerPeso - (rewardPoints % pointsPerPeso);
  const level = profile?.level;
  const nextLevel = profile?.nextLevel;
  const claimAmount = result?.pendingClaim ?? wholePesos;
  const canClaim = !claiming && (result?.pendingClaim || (
    Array.isArray(profile?.redemptions) && !result.message && wholePesos > 0
  ));

  function confirmClaim() {
    if (!canClaim) return;
    if (result.pendingClaim) {
      void submitClaim(claimAmount);
      return;
    }
    Alert.alert(
      'Claim ₱' + pointFormat.format(claimAmount) + '?',
      pointFormat.format(claimAmount * pointsPerPeso) + ' reward points will be deducted and logged in Quest history.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Claim', onPress: () => { void submitClaim(claimAmount); } },
      ]
    );
  }
  const remaining = nextLevel ? Math.max(0, nextLevel.minimumXp - profile.totalXp) : 0;
  const progress = nextLevel && level
    ? Math.round(100 * (profile.totalXp - level.minimumXp) / (nextLevel.minimumXp - level.minimumXp))
    : 100;
  const pending = result?.pendingXp > 0 || result?.pendingRewardPoints > 0;
  if (!result) return <LoadingScreen message="Loading Pantry Quest…" />;

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.screen} showsVerticalScrollIndicator persistentScrollbar>
        <SectionCard title={currentUser.displayName + '’s progress'}>
          {!result ? <Text style={styles.body}>Loading Pantry Quest…</Text> : null}
          {result.message ? <Text style={styles.body}>{result.message}</Text> : null}
          <Text style={styles.body}>Use the minus button when you use a product. Confirmed purchases and manually added shopping items also earn points after syncing.</Text>
          {profile ? (
            <>
              {level ? <Text style={styles.level}>Level {level.number} · {level.title}</Text> : null}
              <Text style={styles.total}>{profile.totalXp} XP</Text>
              {level ? (
                <>
                  <View
                    accessibilityRole="progressbar"
                    accessibilityLabel="Progress to next level"
                    accessibilityValue={{ min: 0, max: 100, now: progress }}
                    style={styles.progressTrack}
                  >
                    <View style={[styles.progressFill, { width: progress + '%' }]} />
                  </View>
                  <Text style={styles.body}>
                    {nextLevel ? remaining + ' XP to ' + nextLevel.title : 'Highest level reached'}
                  </Text>
                </>
              ) : null}
              <Text style={styles.body}>{pointFormat.format(profile.rewardPoints)} reward points</Text>
              <Text style={styles.body}>{profile.streak}-day streak · {profile.contributions} contributions</Text>
            </>
          ) : null}
          {pending ? (
            <Text style={styles.body}>
              Pending estimate: {result.pendingXp} XP · {result.pendingRewardPoints} reward points
            </Text>
          ) : null}
        </SectionCard>
        <SectionCard title="Reward point value" subtitle="10,000 reward points = ₱1">
          {profile ? (
            <>
              <Text style={styles.total}>{'₱' + pointFormat.format(wholePesos)}</Text>
              <Text style={styles.body}>{pointFormat.format(pointsToNextPeso)} points to the next peso</Text>
            </>
          ) : null}
        </SectionCard>
        {Array.isArray(profile?.redemptions) || result?.pendingClaim ? (
          <SectionCard title="Redemption history">
            {claiming ? <LoadingScreen compact message="Confirming claim…" /> : null}
            <Pressable accessibilityRole="button" disabled={!canClaim} onPress={confirmClaim}
              style={[styles.claim, !canClaim && styles.claimDisabled]}>
              <Text style={styles.claimText}>
                {claiming ? 'Confirming claim…' : result.pendingClaim ? 'Retry claim'
                  : wholePesos > 0 ? 'Claim ₱' + pointFormat.format(wholePesos) : 'Claim reward points'}
              </Text>
            </Pressable>
            {profile?.redemptions?.length ? profile.redemptions.map((entry) => (
              <View key={entry.id} style={styles.badge}>
                <Text style={styles.badgeTitle}>Redeemed points · {currentUser.displayName}</Text>
                <Text selectable style={styles.badgeTitle}>
                  Reference: {formatRedemptionReference(entry.redeemedAt) ?? 'Unavailable'}
                </Text>
                <Text style={styles.body}>
                  {pointFormat.format(entry.points)} points · {'₱' + pointFormat.format(entry.pesos)}
                </Text>
                <Text style={styles.badgeDetail}>{new Date(entry.redeemedAt).toLocaleString()}</Text>
                <Text selectable style={styles.badgeDetail}>Claim ID: {entry.id}</Text>
              </View>
            )) : <Text style={styles.badgeDetail}>No points redeemed yet.</Text>}
          </SectionCard>
        ) : null}
        <SectionCard title="Family Leaderboard" subtitle="Weekly XP resets on Mondays, Philippine time.">
          {result.leaderboardMessage ? <Text style={styles.badgeDetail}>{result.leaderboardMessage}</Text> : null}
          {profile?.leaderboard?.map((member, index) => (
            <View key={index} style={[styles.badge, member.isYou && styles.earnedBadge]}>
              <Text style={styles.badgeTitle}>#{member.rank} {member.name}{member.isYou ? ' (you)' : ''}</Text>
              <Text style={styles.body}>{pointFormat.format(member.weeklyXp)} XP this week</Text>
              <Text style={styles.badgeDetail}>{pointFormat.format(member.contributions)} total contributions</Text>
              {member.badges.length ? <Text style={styles.badgeDetail}>{member.badges.join(', ')}</Text> : null}
            </View>
          ))}
        </SectionCard>
        {profile?.achievements?.length ? (
          <SectionCard title="Achievements">
            {profile.achievements.map((badge) => (
              <View key={badge.id} style={[styles.badge, badge.earned && styles.earnedBadge]}>
                <Text style={styles.badgeTitle}>{badge.title}</Text>
                <Text style={styles.badgeDetail}>
                  {badge.earned ? 'Earned · ' : ''}{badge.progress}/{badge.target} {metricLabels[badge.metric]}
                </Text>
              </View>
            ))}
          </SectionCard>
        ) : null}
        {profile?.recentLedger.length ? (
          <SectionCard title="Recent scoring activity">
            {profile.recentLedger.map((entry) => (
              <Text key={entry.id} style={styles.body}>
                {entry.reverses_id ? 'Correction · ' : ''}{actionLabels[entry.action] ?? entry.action}
                {' · '}{entry.xp > 0 ? '+' : ''}{entry.xp} XP
                {' · '}{entry.reward_points > 0 ? '+' : ''}{entry.reward_points} points
              </Text>
            ))}
          </SectionCard>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg },
  claim: { alignSelf: 'flex-start', borderRadius: 12, backgroundColor: colors.primaryDark, padding: spacing.sm },
  claimDisabled: { backgroundColor: colors.textSecondary },
  claimText: { ...typography.body, color: '#FFFFFF', fontWeight: '700' },
  level: { ...typography.heading, color: colors.textPrimary },
  progressTrack: { height: 10, borderRadius: 8, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 8, backgroundColor: colors.primary },
  badge: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  earnedBadge: { backgroundColor: colors.surfaceAlt },
  badgeTitle: { ...typography.body, fontWeight: '700', color: colors.primaryDark },
  badgeDetail: { ...typography.caption, color: colors.textSecondary },
  total: { ...typography.title, color: colors.primaryDark },
  body: { ...typography.body, color: colors.textPrimary },
});
