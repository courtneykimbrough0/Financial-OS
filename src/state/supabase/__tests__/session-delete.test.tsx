import { act, render, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { OWNER_HEADER } from '../adapter';
import { SupabaseAccountGate, useSupabaseAccount, type SupabaseAccount } from '../session';

/*
 * With a stand-in client (no network): the deletion request is bound to the
 * signed-in account, so ownerGuardFetch stops it if the browser's session
 * changed to someone else between the password check and the request.
 */
describe('deleting an account', () => {
  it('sends delete_account bound to the account being deleted', async () => {
    const marks: [string, string][] = [];
    const fake = {
      auth: {
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          queueMicrotask(() => cb('INITIAL_SESSION', { user: { id: 'user-a', email: 'a@example.test' } }));
          return { data: { subscription: { unsubscribe() {} } } };
        },
        signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'user-a' } }, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
        getSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-a' } } }, error: null })),
      },
      rpc: (fn: string) => ({
        setHeader(name: string, value: string) {
          marks.push([fn, `${name}=${value}`]);
          return Promise.resolve({ data: null, error: null, status: 204 });
        },
      }),
    } as unknown as SupabaseClient;
    let account: SupabaseAccount | null = null;
    function Probe() {
      account = useSupabaseAccount();
      return null;
    }
    const none = () => null;
    render(
      <SupabaseAccountGate client={fake} verifier={() => fake} screens={{ SignedOut: none, NewPassword: none, Recovery: none }} slot={{ Card: none, Line: none, Guard: none, dataNote: '' }}>
        {() => <Probe />}
      </SupabaseAccountGate>,
    );
    await waitFor(() => expect(account).not.toBeNull());
    await act(async () => {
      expect(await account!.deleteAccount('the-password')).toBeNull();
    });
    expect(marks).toEqual([['delete_account', `${OWNER_HEADER}=user-a`]]);
  });
});
