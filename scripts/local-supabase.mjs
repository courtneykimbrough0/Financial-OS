// The local Supabase stack the integration and browser tests use, checked
// before anything runs: only an address on this machine, only a public (anon
// or publishable) key, and the stack must answer. Exits with status 2 otherwise.
export async function localSupabase() {
  const url = process.env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321';
  const key = process.env.SUPABASE_TEST_ANON_KEY ?? '';
  const fail = (message) => {
    console.error(message);
    process.exit(2);
  };

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    fail(`SUPABASE_TEST_URL must be a local Supabase stack (127.0.0.1 or localhost); got "${host || url}". These tests never run against a hosted project.`);
  }
  if (!key) fail('Set SUPABASE_TEST_ANON_KEY to the local stack’s anon or publishable key (shown by `supabase status`).');
  const role = (() => {
    if (key.startsWith('sb_publishable_')) return 'anon';
    if (key.startsWith('sb_secret_')) return 'secret';
    try {
      return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
    } catch {
      return 'unknown';
    }
  })();
  if (role !== 'anon') fail(`SUPABASE_TEST_ANON_KEY must be the public anon or publishable key, not a ${role} key.`);

  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    fail(`No Supabase stack answered at ${url} (${err.message}). Start one with \`supabase start\`.`);
  }
  return { url, key };
}
