/**
 * When the app is served by server.mjs (Cloud Run), Firebase's sign-in pages
 * are forwarded through the app's own address, so sign-in should use that
 * address: Safari and installed iPhone apps block sign-in on a different one.
 * Anywhere else (Firebase Hosting, the Vite dev server) the configured
 * authDomain is used.
 */
export async function forwardedAuthDomain(fetchImpl: typeof fetch = fetch, host: string = window.location.host, timeoutMs = 2500): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl('/__/financial-os/config.json', { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { authProxy?: unknown };
    return body.authProxy === true ? host : null;
  } catch {
    // Offline, or a host without the config file (it answers with the app's HTML).
    return null;
  } finally {
    clearTimeout(timer);
  }
}
