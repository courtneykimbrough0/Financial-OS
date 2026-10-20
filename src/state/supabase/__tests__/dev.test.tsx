import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devConfigProblem, SupabaseDevelopment } from '../dev';

const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;

describe('development Supabase configuration', () => {
  it('accepts only a stack on this machine with a public key', () => {
    expect(devConfigProblem('http://127.0.0.1:54321', 'sb_publishable_abc')).toBeNull();
    expect(devConfigProblem('http://localhost:54321', jwt('anon'))).toBeNull();
    expect(devConfigProblem('https://abc.supabase.co', 'sb_publishable_abc')).toBe('VITE_SUPABASE_URL must be a local Supabase stack (127.0.0.1 or localhost).');
    expect(devConfigProblem('not a url', 'sb_publishable_abc')).toBe('VITE_SUPABASE_URL must be a local Supabase stack (127.0.0.1 or localhost).');
    expect(devConfigProblem('http://127.0.0.1:54321', undefined)).toMatch(/^Set VITE_SUPABASE_ANON_KEY/);
    expect(devConfigProblem('http://127.0.0.1:54321', 'sb_secret_abc')).toBe('VITE_SUPABASE_ANON_KEY is a secret key. Use the anon or publishable key.');
    expect(devConfigProblem('http://127.0.0.1:54321', jwt('service_role'))).toBe('VITE_SUPABASE_ANON_KEY is a service_role key. Use the anon or publishable key.');
    expect(devConfigProblem('http://127.0.0.1:54321', 'nonsense')).toBe("VITE_SUPABASE_ANON_KEY isn't a Supabase key.");
  });

  afterEach(() => vi.unstubAllEnvs());

  it('refuses to start, and never renders the app, with a hosted address or a privileged key', () => {
    for (const [url, key] of [
      ['https://abc.supabase.co', 'sb_publishable_abc'],
      ['http://127.0.0.1:54321', jwt('service_role')],
    ]) {
      vi.stubEnv('VITE_SUPABASE_URL', url);
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
      const app = vi.fn(() => <p>app</p>);
      const { unmount } = render(<SupabaseDevelopment>{app}</SupabaseDevelopment>);
      expect(screen.getByRole('alert')).toHaveTextContent(/^Development storage couldn't start\./);
      expect(app).not.toHaveBeenCalled();
      unmount();
    }
  });
});
