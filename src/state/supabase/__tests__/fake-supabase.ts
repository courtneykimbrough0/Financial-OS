/**
 * A controllable stand-in for a supabase-js client in unit tests. It follows
 * the database functions' rules that matter to the adapter (one workspace,
 * revisions, conflicts, save receipts keyed by save id and fingerprint, the
 * reset mode's empty plan) and can be told to fail in specific ways. The real
 * functions are tested in PostgreSQL (`*.db.test.ts`) and through the real
 * Supabase stack (`*.supabase.test.ts`).
 */
import type { RpcClient, RpcError } from '../adapter';
import type { LoadedPlan, PlanRows } from '../rows';

type Reply = { data: unknown; error: RpcError | null; status: number };

export type Failure =
  /** The request never reaches the database. */
  | 'network-before'
  /** The database applies the save, but the reply is lost. */
  | 'network-after'
  /** A gateway error before the database ran it. */
  | 'server-error'
  /** The session ended: the request runs as the signed-out role. */
  | 'signed-out'
  /** The database refuses the plan (a check failed); nothing applied. */
  | 'check-violation';

export class FakeSupabase implements RpcClient {
  workspace: { revision: number; plan: PlanRows } | null = null;
  receipts = new Map<string, { fingerprint: string; revision: number }>();
  calls: { fn: string; args?: Record<string, unknown> }[] = [];
  private failures: Failure[] = [];
  /** Held replies: each call waits for `release()` when set. */
  hold = false;
  private waiting: (() => void)[] = [];

  failNext(...f: Failure[]) {
    this.failures.push(...f);
  }

  release() {
    const w = this.waiting;
    this.waiting = [];
    w.forEach((r) => r());
  }

  /** Another device saves. */
  externalSave(plan: PlanRows) {
    if (!this.workspace) throw new Error('no workspace');
    this.workspace = { revision: this.workspace.revision + 1, plan: structuredClone(plan) };
  }

  async rpc(fn: string, args?: Record<string, unknown>): Promise<Reply> {
    this.calls.push({ fn, args: args ? structuredClone(args) : undefined });
    if (this.hold) await new Promise<void>((r) => this.waiting.push(r));
    const failure = this.failures.shift();
    if (failure === 'network-before') return { data: null, error: { message: 'TypeError: fetch failed', code: '' }, status: 0 };
    if (failure === 'server-error') return { data: null, error: { message: 'Bad gateway', code: '' }, status: 502 };
    if (failure === 'signed-out') return { data: null, error: { message: `permission denied for function ${fn}`, code: '42501' }, status: 401 };
    if (failure === 'check-violation') return { data: null, error: { message: 'new row violates check constraint', code: '23514' }, status: 400 };
    const reply = this.run(fn, args);
    if (failure === 'network-after') return { data: null, error: { message: 'TypeError: fetch failed', code: '' }, status: 0 };
    return reply;
  }

  private run(fn: string, args?: Record<string, unknown>): Reply {
    if (fn === 'create_workspace') {
      this.workspace ??= { revision: 0, plan: { onboarding_complete: false, review_cadence: null, review_handled_on: null, review_outcome: null, sources: [], versions: [], pauses: [], records: [] } };
      return { data: 'ws-1', error: null, status: 200 };
    }
    if (fn === 'load_plan') {
      if (!this.workspace) return { data: null, error: null, status: 200 };
      const loaded: LoadedPlan = { ...structuredClone(this.workspace.plan), workspace_id: 'ws-1', revision: this.workspace.revision, schema_version: 2 };
      return { data: loaded, error: null, status: 200 };
    }
    if (fn === 'save_plan') {
      if (!this.workspace) return { data: null, error: { message: 'There is no plan to save to yet.', code: 'PT404' }, status: 404 };
      const { p_base_revision: base, p_save_id: id, p_mode: mode, p_plan: plan } = args as { p_base_revision: number; p_save_id: string; p_mode: string; p_plan: PlanRows };
      const fingerprint = JSON.stringify([mode, base, plan]);
      const receipt = this.receipts.get(id);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) return { data: null, error: { message: 'This save request was already used for a different change.', code: 'PT422' }, status: 422 };
        return { data: { status: 'already_saved', revision: receipt.revision, current_revision: this.workspace.revision }, error: null, status: 200 };
      }
      if (this.workspace.revision !== base) return { data: null, error: { message: 'Your plan was changed somewhere else.', code: 'PT409' }, status: 409 };
      if (mode === 'reset' && (plan.sources.length || plan.records.length || plan.onboarding_complete)) {
        return { data: null, error: { message: 'Starting over needs an empty plan in setup.', code: 'PT422' }, status: 422 };
      }
      const revision = base + 1;
      this.workspace = { revision, plan: structuredClone(plan) };
      this.receipts.set(id, { fingerprint, revision });
      return { data: { status: 'saved', revision, current_revision: revision }, error: null, status: 200 };
    }
    return { data: null, error: { message: `unknown function ${fn}`, code: 'PGRST202' }, status: 404 };
  }
}
