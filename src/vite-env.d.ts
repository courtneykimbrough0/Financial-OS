interface ImportMetaEnv {
  readonly VITE_ACCOUNTS?: string;
  /** Development only (`supabase-dev` mode): a local Supabase stack and its public key. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
