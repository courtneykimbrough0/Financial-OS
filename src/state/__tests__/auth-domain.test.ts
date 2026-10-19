import { describe, expect, it } from 'vitest';
import { forwardedAuthDomain } from '../auth-domain';

const respond = (body: string, ok = true) => (async () => new Response(body, { status: ok ? 200 : 404 })) as typeof fetch;

describe('forwardedAuthDomain', () => {
  it('uses the app’s own address when server.mjs forwards sign-in', async () => {
    expect(await forwardedAuthDomain(respond('{"authProxy":true}'), 'app.example.run.app')).toBe('app.example.run.app');
  });

  it('keeps the configured address on other hosts', async () => {
    // Firebase Hosting and the dev server answer with the app's HTML.
    expect(await forwardedAuthDomain(respond('<!doctype html>'), 'x')).toBeNull();
    expect(await forwardedAuthDomain(respond('{}'), 'x')).toBeNull();
    expect(await forwardedAuthDomain(respond('nope', false), 'x')).toBeNull();
  });

  it('keeps the configured address when offline or slow', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await forwardedAuthDomain(offline, 'x')).toBeNull();
    const slow = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    expect(await forwardedAuthDomain(slow, 'x', 20)).toBeNull();
  });
});
