export function resolveQuantityConflict(localEvent, remoteSnapshot) {
  return {
    strategy: 'EVENT_BASED_DELTA',
    message:
      'Apply quantity adjustments as deltas in order, then refresh latest snapshot from server.',
    localEvent,
    remoteSnapshot,
  };
}
