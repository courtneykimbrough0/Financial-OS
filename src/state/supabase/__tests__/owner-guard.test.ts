// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OWNER_HEADER, ownerGuardFetch, tokenUser } from '../adapter';

const token = (sub?: string) => `h.${Buffer.from(JSON.stringify(sub ? { sub, role: 'authenticated' } : { role: 'anon' })).toString('base64url')}.s`;
const call = (owner: string | null, auth: string) => {
  const headers: Record<string, string> = { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' };
  if (owner) headers[OWNER_HEADER] = owner;
  return ['http://127.0.0.1:54321/rest/v1/rpc/save_plan', { method: 'POST', headers, body: '{"p_mode":"update"}' }] as const;
};

describe('requests bound to an account', () => {
  it("go out with their own account's token, without the binding mark", async () => {
    const base = vi.fn(async (_r: Request) => new Response('{}', { status: 200 }));
    const res = await ownerGuardFetch(base as unknown as typeof fetch)(...call('user-a', token('user-a')));
    expect(res.status).toBe(200);
    const sent = base.mock.calls[0]![0];
    expect([sent.headers.get(OWNER_HEADER), sent.headers.get('authorization'), await sent.text()]).toEqual([null, `Bearer ${token('user-a')}`, '{"p_mode":"update"}']);
  });

  it('are stopped before sending when the session now belongs to another account', async () => {
    const base = vi.fn(async () => new Response('{}', { status: 200 }));
    const res = await ownerGuardFetch(base as unknown as typeof fetch)(...call('user-a', token('user-b')));
    expect(base).not.toHaveBeenCalled();
    expect([res.status, (await res.json()).code]).toEqual([401, 'FO401']);
  });

  it('with no user token at all go out, and the server refuses them as signed out', async () => {
    const base = vi.fn(async () => new Response('{}', { status: 401 }));
    await ownerGuardFetch(base as unknown as typeof fetch)(...call('user-a', token()));
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('unbound requests (sign-in, refresh) pass through untouched', async () => {
    const base = vi.fn(async () => new Response('{}', { status: 200 }));
    await ownerGuardFetch(base as unknown as typeof fetch)(...call(null, token('user-b')));
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("reads the user from a token, and nothing from something that isn't one", () => {
    expect([tokenUser(`Bearer ${token('u1')}`), tokenUser(`Bearer ${token()}`), tokenUser('Bearer sb_publishable_x'), tokenUser(null)]).toEqual(['u1', null, null, null]);
  });
});
