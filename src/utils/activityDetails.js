export function readActivityDetails(item) {
  try {
    return JSON.parse(item.metadata_json || '{}') || {};
  } catch {
    return {};
  }
}

export const syncStatusLabels = {
  PENDING: 'Pending',
  FAILED: 'Waiting to retry',
  CONFLICT: 'Conflict',
  SYNCED: 'Synced',
  LOCAL_ONLY: 'Local only',
};
