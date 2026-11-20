import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import LoadingScreen from '../../components/common/LoadingScreen';
import ScreenShell from '../../components/common/ScreenShell';
import SectionCard from '../../components/common/SectionCard';
import StatCard from '../../components/common/StatCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { useGrocerySync } from '../../state/grocerySyncStore';
import { useSession } from '../../state/sessionStore';
import { getDatedStock, getInventorySummary } from '../../db/repositories/productsRepo';
import { getRecentActivities } from '../../db/repositories/activityRepo';
import { expirationNotice } from '../../utils/expiration';
import { readActivityDetails, syncStatusLabels } from '../../utils/activityDetails';
import { INVENTORY_ACTIONS } from '../../constants/actions';

function toReadableAction(action) {
  if (action === INVENTORY_ACTIONS.QUANTITY_DECREASED) return 'decreased quantity';
  if (action === INVENTORY_ACTIONS.QUANTITY_INCREASED) return 'increased quantity';
  if (action === INVENTORY_ACTIONS.SHOPPING_MARKED_PURCHASED) return 'marked shopping item purchased';
  if (action === INVENTORY_ACTIONS.PRODUCT_CREATED) return 'added a product';
  if (action === INVENTORY_ACTIONS.PRODUCT_UPDATED) return 'edited a product';
  if (action === INVENTORY_ACTIONS.PRODUCT_ARCHIVED) return 'archived a product';
  if (action === 'SHOPPING_ITEM_ADDED') return 'added a shopping item';
  return action;
}

export function NotificationsScreen() {
  return <DashboardScreen notificationsOnly />;
}

export default function DashboardScreen({ navigation, notificationsOnly = false }) {
  const { revision } = useGrocerySync();
  const { currentUser, userNamesById } = useSession();
  const [stats, setStats] = useState({
    totalActive: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [datedStock, setDatedStock] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [summary, activities, datedProducts] = await Promise.all([
        notificationsOnly ? null : getInventorySummary(),
        getRecentActivities(notificationsOnly ? 20 : 6, currentUser?.role === 'ADMIN' ? null : currentUser.id),
        getDatedStock(),
      ]);

      if (summary) {
        setStats({
          totalActive: summary.totalActive,
          lowStockCount: summary.lowStockCount,
          outOfStockCount: summary.outOfStockCount,
        });
      }
      setRecentActivities(activities);
      setDatedStock(datedProducts);
      setLoaded(true);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, currentUser?.role, revision, notificationsOnly]);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

  const expirationAlerts = datedStock
    .map((product) => ({ ...product, notice: expirationNotice(product.expiration_date) }))
    .filter((product) => product.notice);

  if (loading && !loaded) return <LoadingScreen message="Loading dashboard…" />;

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={styles.screen}
        showsVerticalScrollIndicator
        persistentScrollbar
        indicatorStyle="black"
      >
        {!notificationsOnly ? <Text style={styles.title}>Hello, {currentUser?.displayName}</Text> : null}
        {loading ? <LoadingScreen compact message="Refreshing dashboard…" /> : null}
        {loadFailed ? (
          <SectionCard title={notificationsOnly ? "Could not load notifications" : "Could not load dashboard"}>
            <Pressable accessibilityRole="button" onPress={loadDashboardData}>
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </SectionCard>
        ) : null}
        {loaded ? (<>
        {!notificationsOnly ? <>
        <View style={styles.statsRow}>
          <StatCard label="Active products" value={String(stats.totalActive)} onPress={() => navigation.navigate('Inventory')} />
          <StatCard label="Low stock" value={String(stats.lowStockCount)} tone="warning" onPress={() => navigation.navigate('LowStock')} />
        </View>

        <View style={styles.statsRow}>
          <StatCard label="Out of stock" value={String(stats.outOfStockCount)} tone="danger" onPress={() => navigation.navigate('OutOfStock')} />
          <StatCard label="To buy" value={String(stats.outOfStockCount)} onPress={() => navigation.navigate('Shopping')} />
        </View>

        </> : null}

        {notificationsOnly || expirationAlerts.length > 0 ? (
          <SectionCard title="Expiring products">
            {!expirationAlerts.length ? <Text style={styles.activityMeta}>No expiring products.</Text> : null}
            {expirationAlerts.map(({ id, name, notice, expiration_date }) => (
              <Text key={id} style={styles.activityText}>
                {name} · {expiration_date} · {notice}
              </Text>
            ))}
          </SectionCard>
        ) : null}

        <SectionCard title="Recent activity">
          <View style={styles.activityList}>
            {recentActivities.map((item) => {
              const details = readActivityDetails(item);
              const actorName = userNamesById[item.user_id] || details.actorName || item.user_id;
              const productName = item.product_name || details.productName || details.label || 'shopping item';

              return (
                <View key={item.id} style={styles.activityRow}>
                  <Text style={styles.activityText}>
                    {actorName} {toReadableAction(item.action)} on {productName}
                  </Text>
                  {notificationsOnly ? <Text style={styles.activityMeta}>{new Date(item.occurred_at).toLocaleString()}</Text> : null}
                  <Text style={styles.activityMeta}>
                    {item.prev_quantity ?? '-'} to {item.new_quantity ?? '-'} • {syncStatusLabels[item.sync_status] || item.sync_status}
                  </Text>
                </View>
              );
            })}
            {recentActivities.length === 0 ? (
              <Text style={styles.activityMeta}>No recent activity yet.</Text>
            ) : null}
          </View>
        </SectionCard>

        {!notificationsOnly ? <SectionCard title="Current Role">
          <Text style={styles.roleText}>{currentUser?.role}</Text>
        </SectionCard> : null}
        </>) : null}
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  screen: {
    padding: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  retry: { ...typography.body, color: colors.primaryDark, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  activityRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    padding: spacing.sm,
  },
  activityList: {
    gap: spacing.sm,
  },
  activityText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  activityMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  roleText: {
    ...typography.heading,
    color: colors.primaryDark,
  },
});
