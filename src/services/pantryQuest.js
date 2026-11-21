import { getDatabase } from '../db/sqlite';
import { getPendingSyncItems } from '../db/repositories/syncQueueRepo';
import { generateId } from '../utils/ids';
import { supabase } from './supabase/client';

const rules = {
  STOCK_USED: { xp: 2, rewardPoints: 1 },
  SHOPPING_ITEM_ADDED: { xp: 3, rewardPoints: 1 },
  STOCK_RESTOCKED: { xp: 10, rewardPoints: 1 },
};

export async function getPantryQuest(userId) {
  const db = await getDatabase();
  const cached = await db.getFirstAsync('SELECT profile_json FROM quest_profile_cache WHERE user_id = ?;', [userId]);
  let profile = cached ? JSON.parse(cached.profile_json) : null;
  let leaderboardMessage = 'Connect to refresh the family leaderboard.';
  let message = 'Connect to refresh your Pantry Quest profile.';
  try {
    const { data: session } = await supabase.auth.getSession();
    if (session.session?.user.id === userId) {
      const request = (name) => supabase.rpc(name)
        .setHeader('Authorization', 'Bearer ' + session.session.access_token);
      const [initial, leaderboard] = await Promise.all([
        request('pantry_quest_rewards_profile'),
        request('pantry_quest_leaderboard'),
      ]);
      let response = initial;
      if (leaderboard.error?.code === 'PGRST202') {
        leaderboardMessage = 'The leaderboard still needs to be enabled in Supabase.';
      }
      if (response.error?.code === 'PGRST202') response = await request('pantry_quest_progression_profile');
      if (response.error?.code === 'PGRST202') response = await request('pantry_quest_profile');
      const { data, error } = response;
      if (data?.userId === userId && !error) {
        const latestRankings = Array.isArray(leaderboard.data) && !leaderboard.error;
        profile = { ...data, leaderboard: latestRankings ? leaderboard.data : profile?.leaderboard };
        if (latestRankings) leaderboardMessage = null;
        await db.runAsync(
          `INSERT INTO quest_profile_cache (user_id, profile_json) VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET profile_json = excluded.profile_json;`,
          [userId, JSON.stringify(profile)]
        );
        message = null;
      } else if (error?.code === 'PGRST202') {
        message = 'Pantry Quest scoring has not been enabled in Supabase yet.';
      }
    }
  } catch {
    // Continue showing the account's last confirmed profile while offline.
  }

  const confirmed = new Set(profile?.recentLedger.map((entry) => entry.source_key));
  const pending = await getPendingSyncItems(db);
  const returnedUses = new Set(pending.filter((row) => row.operation === 'return_usage')
    .map((row) => JSON.parse(row.payload_json).payload.original_transaction_id));
  const pendingAwards = pending.flatMap((row) => {
    const { actor, payload } = JSON.parse(row.payload_json);
    if (actor !== userId || returnedUses.has(row.transaction_id) || confirmed.has('inventory:' + row.transaction_id)) return [];
    const action = row.operation === 'add_shopping_item' ? 'SHOPPING_ITEM_ADDED'
      : row.operation === 'restock_product' ? 'STOCK_RESTOCKED'
      : row.operation === 'adjust_quantity' && payload.quest_intent === 'usage' && payload.delta < 0
        ? 'STOCK_USED' : null;
    const rule = action && (profile?.rules ?? rules)[action];
    return rule ? [rule] : [];
  });
  const pendingClaim = await db.getFirstAsync(
    'SELECT pesos FROM quest_pending_redemption WHERE user_id = ?;', [userId]
  );
  return {
    profile,
    leaderboardMessage,
    pendingClaim: pendingClaim?.pesos ?? null,
    message,
    pendingXp: pendingAwards.reduce((sum, rule) => sum + rule.xp, 0),
    pendingRewardPoints: pendingAwards.reduce((sum, rule) => sum + rule.rewardPoints, 0),
  };
}


export async function claimQuestPoints(userId, pesos) {
  const db = await getDatabase();
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || data.session?.user.id !== userId) {
    throw new Error('Connect and sign in before claiming your points.');
  }

  // Keep the same ID if the connection drops after Supabase accepts the claim.
  await db.runAsync(
    'INSERT INTO quest_pending_redemption (user_id, request_id, pesos) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING;',
    [userId, generateId('quest-claim'), pesos]
  );
  const pending = await db.getFirstAsync(
    'SELECT request_id, pesos FROM quest_pending_redemption WHERE user_id = ?;', [userId]
  );
  const { data: claim, error } = await supabase.rpc('pantry_quest_redeem_points', {
    p_request_id: pending.request_id, p_pesos: pending.pesos,
  }).setHeader('Authorization', 'Bearer ' + data.session.access_token);

  if (!error && (!claim?.request_id || !claim?.redeemed_at)) {
    throw new Error('Claim could not be verified. Retry when connected.');
  }

  if (!error || ['22023', '23514', '42501', 'PGRST202'].includes(error.code)) {
    await db.runAsync('DELETE FROM quest_pending_redemption WHERE user_id = ? AND request_id = ?;',
      [userId, pending.request_id]);
  }
  if (error) throw new Error(error.message || 'Claim could not be verified. Retry when connected.');
  return claim;
}
