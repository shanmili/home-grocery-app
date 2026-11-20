const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!URL.canParse(url ?? '') || new URL(url).protocol !== 'https:') {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL to the HTTPS Supabase project URL.');
  process.exitCode = 1;
}

function isPublicKey(value) {
  if (value?.startsWith('sb_publishable_') && value.length > 'sb_publishable_'.length) {
    return true;
  }

  // Existing Supabase projects may still use the legacy anon JWT.
  const segments = value?.split('.');
  if (segments?.length !== 3) return false;

  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url')).role === 'anon';
  } catch {
    return false;
  }
}

if (!isPublicKey(key)) {
  console.error('Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to a publishable key or legacy anon key.');
  process.exitCode = 1;
}
