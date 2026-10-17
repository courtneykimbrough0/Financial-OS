export interface SupabaseTarget {
  kind: 'local' | 'hosted';
  url: string;
  key: string;
  mailUrl: string | null;
  ref: string | null;
  outboxSecret: string | null;
}
export const MARKER_PREFIX: string;
export function keyRole(key: string | undefined): { role: string; ref: string | null };
export function checkTarget(env: Record<string, string | undefined>, approved: string[]): { ok: true; target: SupabaseTarget } | { ok: false; error: string };
export function approvedProjects(path?: URL | string): string[];
export function supabaseTarget(env?: Record<string, string | undefined>): Promise<SupabaseTarget>;
export function testEnv(t: SupabaseTarget): Record<string, string>;
