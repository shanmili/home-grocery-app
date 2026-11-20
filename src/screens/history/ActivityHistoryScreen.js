import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import LoadingScreen from '../../components/common/LoadingScreen';
import ScreenShell from '../../components/common/ScreenShell';
import SectionCard from '../../components/common/SectionCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { getActivityHistory } from '../../db/repositories/activityRepo';
import { readActivityDetails, syncStatusLabels } from '../../utils/activityDetails';
import { INVENTORY_ACTIONS } from '../../constants/actions';
import { buildActivityTimeline } from '../../utils/activityTimeline';
import { useGrocerySync } from '../../state/grocerySyncStore';
import { useSession } from '../../state/sessionStore';

function toReadableAction(action) {
  if (action === INVENTORY_ACTIONS.QUANTITY_DECREASED) return 'decreased quantity';
  if (action === INVENTORY_ACTIONS.QUANTITY_INCREASED) return 'increased quantity';
  if (action === INVENTORY_ACTIONS.PRODUCT_CREATED) return 'added a product';
  if (action === INVENTORY_ACTIONS.PRODUCT_UPDATED) return 'edited a product';
  if (action === INVENTORY_ACTIONS.PRODUCT_ARCHIVED) return 'archived a product';
  if (action === 'SHOPPING_ITEM_ADDED') return 'added a shopping item';
  if (action === INVENTORY_ACTIONS.SHOPPING_MARKED_PURCHASED) return 'marked shopping item purchased';
  return action;
}

export default function ActivityHistoryScreen() {
  const { revision } = useGrocerySync();
  const { userNamesById, currentUser } = useSession();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadActivities = useCallback(async () => {
    try {
      if (!currentUser?.id) return;
      setLoading(true);
      setLoadFailed(false);
      const rows = await getActivityHistory(currentUser.role === 'ADMIN' ? null : currentUser.id);
      setActivities(rows);
    } catch (error) {
      setLoadFailed(true);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [currentUser?.id, currentUser?.role, revision]);

  useFocusEffect(
    useCallback(() => {
      loadActivities();
    }, [loadActivities])
  );

  const timeline = useMemo(() => buildActivityTimeline(activities), [activities]);

  if (loading && !loaded) return <LoadingScreen message="Loading activity history…" />;

  return (
    <ScreenShell>
      <View style={styles.screen}>
        <SectionCard title="Activity History">
          <Pressable style={styles.refreshButton} onPress={loadActivities} disabled={loading} accessibilityRole="button">
            <Text style={styles.refreshButtonLabel}>Refresh</Text>
          </Pressable>

          {loading ? <LoadingScreen compact message="Refreshing history…" /> : null}

          {loadFailed ? <Text style={styles.infoText}>Could not load history. Try refreshing.</Text> : null}

          <FlatList
            showsVerticalScrollIndicator
            persistentScrollbar
            indicatorStyle="black"
            data={timeline}
            keyExtractor={(item) => item.key}
            renderItem={({ item: row }) => {
              if (row.type !== 'activity') {
                return <Text accessibilityRole="header" style={styles[row.type]}>{row.label}</Text>;
              }
              const item = row.activity;
              const details = readActivityDetails(item);
              const actorName = userNamesById[item.user_id] || details.actorName || item.user_id;
              const productName = item.product_name || details.productName || details.label || 'Product';

              return (
                <View style={styles.row}>
                  <Text style={styles.action}>
                    {actorName} {toReadableAction(item.action)} on {productName}
                  </Text>
                  <Text style={styles.meta}>
                    {item.prev_quantity} to {item.new_quantity} • {syncStatusLabels[item.sync_status] || item.sync_status}
                  </Text>
                  <Text style={styles.time}>{row.timestamp}</Text>
                </View>
              );
            }}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              !loading && !loadFailed ? <Text style={styles.infoText}>No activity history yet.</Text> : null
            }
          />
        </SectionCard>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: spacing.lg,
  },
  refreshButton: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: spacing.sm,
  },
  refreshButtonLabel: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  listContent: {
    gap: spacing.sm,
  },
  infoText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  year: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  month: {
    ...typography.heading,
    color: colors.primaryDark,
  },
  day: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.sm,
    backgroundColor: colors.input,
  },
  action: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
