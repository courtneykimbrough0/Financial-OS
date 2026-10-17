import type { AuthError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { authMessage } from '../session';

const err = (code: string, status = 400, message = 'x') => ({ code, status, message, name: 'AuthApiError' }) as unknown as AuthError;

describe('sign-in messages', () => {
  it('never say whether an account exists for an email', () => {
    // Supabase Auth answers a wrong password and an unknown email the same way; so does the app.
    expect(authMessage(err('invalid_credentials'))).toBe('That email and password don’t match an account. Check them and try again.');
    expect(authMessage(err('user_not_found'))).toBe('That didn’t work. Try again in a moment.');
  });

  it('explain what to do', () => {
    expect(authMessage(err('email_not_confirmed'))).toBe('Confirm your email first: open the link we sent when you created your account.');
    expect(authMessage(err('weak_password', 422))).toBe('Choose a longer password: at least 8 characters.');
    expect(authMessage(err('over_email_send_rate_limit', 429))).toBe('Too many attempts. Wait a few minutes, then try again.');
    expect(authMessage(err('', 0, 'Failed to fetch'))).toBe('Couldn’t reach the server. Check your connection and try again.');
  });
});
