interface ImportMetaEnv {
  readonly VITE_ACCOUNTS?: string;
  /** Development only (`supabase-dev` mode): a local Supabase stack and its public key. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** `supabase-hosted-test` mode only: the approved hosted test project's ref (supabase/hosted-test/projects.json). */
  readonly VITE_SUPABASE_PROJECT_REF?: string;
}
