/**
 * Storage in Supabase, behind the app's StorageAdapter contract. NOT USED BY
 * THE APP YET: nothing constructs it outside tests. See docs/SUPABASE.md.
 *
 * Online-first: the adapter keeps nothing on the device. A change counts as
 * saved only when save_plan confirms it; until then the store keeps it in
 * memory, shows that it isn't saved, offers Try again, and warns before the
 * page closes.
 *
 * Retries: every logical save gets its own save id. A retry of the same save
 * (same plan, same base revision, same intent) reuses that id, so the database
 * applies it at most once and can say whether it already did. When the outcome
 * of a save is unknown (no reply), the adapter remembers it; if a later save
 * then meets a conflict, it asks the database (with the remembered id) whether
 * that earlier save went through, and carries on from there instead of
 * reporting someone else's change.
 */
import type { AppData } from '../../domain/types';
import type { SaveIntent, SaveResult, StorageAdapter } from '../storage';
import { ACCOUNTS_NOT_STORED, fromRows, hasAccountData, toRows, type LoadedPlan, type PlanRows } from './rows';

/** The part of a supabase-js client the adapter uses (`client.rpc`). */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null; status: number }>;
}
export interface RpcError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

interface SaveReply {
  status: 'saved' | 'already_saved';
  revision: number;
  current_revision: number;
}

/** A save whose reply never arrived: it may or may not have been applied. */
interface Unknown {
  key: string;
  saveId: string;
  baseRevision: number;
  intent: SaveIntent;
  plan: PlanRows;
}

const SIGNED_OUT = "You've been signed out, so this change isn't saved. Sign in again, then try again.";
// No usable reply: the change may or may not have reached the database, so this never says it failed.
const OFFLINE = "Couldn't reach the server, so this change isn't confirmed yet. Check your connection and try again.";
const CONFLICT = 'Your data was changed on another device. Reload to see the latest.';
const SAVED_BUT_NEWER = 'Your change was saved, but your data has changed on another device since. Reload to see the latest.';
export const ACCOUNT_CHANGED = "Another account signed in on this device, so this change wasn't sent. It's kept aside for its own account.";

type Outcome =
  | { kind: 'saved'; reply: SaveReply }
  | { kind: 'conflict' }
  | { kind: 'refused'; message: string }
  /** No usable reply: the save may or may not have happened. */
  | { kind: 'unknown'; message: string };

function classify(data: unknown, error: RpcError | null, status: number): Outcome {
  if (!error) return { kind: 'saved', reply: data as SaveReply };
  const code = error.code ?? '';
  if (code === 'PT409') return { kind: 'conflict' };
  // Stopped on this device before sending: the session now belongs to someone else (see ownerGuardFetch).
  if (code === 'FO401') return { kind: 'refused', message: ACCOUNT_CHANGED };
  // Not signed in, an expired session, or the signed-out (anon) role.
  if (code === 'PT401' || code === 'PGRST301' || code === 'PGRST302' || code === '42501' || status === 401) return { kind: 'refused', message: SIGNED_OUT };
  if (code === 'PT422') return { kind: 'refused', message: `This change couldn't be saved: ${error.message}` };
  if (code === 'PT404') return { kind: 'refused', message: "There's no plan to save to. Reload and try again." };
  // A check or key in the database refused the plan; nothing was applied.
  if (/^(22|23)/.test(code)) return { kind: 'refused', message: "This change couldn't be saved because the data didn't pass a safety check. Nothing was changed." };
  // No reply (network), a gateway or server failure, or a timeout: the outcome is unknown.
  if (status === 0 || status >= 500 || code === '57014') return { kind: 'unknown', message: OFFLINE };
  return { kind: 'refused', message: `This change couldn't be saved (${code || status}).` };
}

let counter = 0;
const newSaveId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `00000000-0000-4000-8000-${(Date.now() + counter++).toString(16).padStart(12, '0').slice(-12)}`;

export const CLEAR_UNSUPPORTED =
  "Supabase storage doesn't erase a plan this way. To clear the plan, start over (a reset save); deleting an account and its data is part of sign-in (Step 10d).";

export class SupabaseStorageAdapter implements StorageAdapter {
  readonly onlineFirst = true;
  /** The latest save whose outcome is unknown, if any. */
  private unknown: Unknown | null = null;

  constructor(
    private readonly client: RpcClient,
    private readonly makeSaveId: () => string = newSaveId,
  ) {}

  async load(): Promise<AppData> {
    let plan = await this.call<LoadedPlan | null>('load_plan');
    if (plan === null) {
      await this.call('create_workspace');
      plan = await this.call<LoadedPlan | null>('load_plan');
      if (plan === null) throw new Error('Your plan could not be created.');
    }
    this.unknown = null;
    return fromRows(plan);
  }

  async save(data: AppData, baseRevision: number, intent: SaveIntent = 'update'): Promise<SaveResult> {
    // The database has no place for accounts yet: refuse rather than drop them.
    if (hasAccountData(data)) return { ok: false, reason: 'error', message: ACCOUNTS_NOT_STORED };
    const plan = toRows(data);
    const key = `${intent}|${baseRevision}|${JSON.stringify(plan)}`;
    // The same logical save again (Try again after no reply): same id, so it can't apply twice.
    const saveId = this.unknown?.key === key ? this.unknown.saveId : this.makeSaveId();
    const outcome = await this.send(saveId, baseRevision, intent, plan);

    if (outcome.kind === 'unknown') {
      this.unknown = { key, saveId, baseRevision, intent, plan };
      return { ok: false, reason: 'error', message: outcome.message };
    }
    const earlier = this.unknown?.key === key ? null : this.unknown;
    this.unknown = null;

    if (outcome.kind === 'saved') return this.settle(outcome.reply);
    if (outcome.kind === 'refused') return { ok: false, reason: 'error', message: outcome.message };

    // Conflict. If an earlier save's outcome was unknown, it may be what moved the revision: ask.
    if (earlier && earlier.baseRevision === baseRevision) {
      const probe = await this.send(earlier.saveId, earlier.baseRevision, earlier.intent, earlier.plan);
      if (probe.kind === 'saved' && probe.reply.status === 'already_saved' && probe.reply.current_revision === probe.reply.revision) {
        // It did, and nothing else has been saved since. This plan already includes that change, so save it on top.
        return this.save(data, probe.reply.revision, intent);
      }
      if (probe.kind === 'saved' && probe.reply.status === 'already_saved') return { ok: false, reason: 'conflict', message: SAVED_BUT_NEWER };
      if (probe.kind === 'unknown') {
        this.unknown = earlier;
        return { ok: false, reason: 'error', message: probe.message };
      }
    }
    return { ok: false, reason: 'conflict', message: CONFLICT };
  }

  /**
   * A confirmed save. `already_saved` with a newer current revision means this
   * save went through earlier but other saves followed: the plan on screen is
   * behind, so the person reloads rather than carrying on from an old revision.
   */
  private settle(reply: SaveReply): SaveResult {
    if (reply.status === 'already_saved' && reply.current_revision !== reply.revision) return { ok: false, reason: 'conflict', message: SAVED_BUT_NEWER };
    return { ok: true, revision: reply.revision };
  }

  private async send(saveId: string, baseRevision: number, intent: SaveIntent, plan: PlanRows): Promise<Outcome> {
    try {
      const { data, error, status } = await this.client.rpc('save_plan', { p_base_revision: baseRevision, p_save_id: saveId, p_mode: intent, p_plan: plan });
      return classify(data, error, status);
    } catch {
      return { kind: 'unknown', message: OFFLINE };
    }
  }

  private async call<T>(fn: string): Promise<T> {
    let result: { data: unknown; error: RpcError | null; status: number };
    try {
      result = await this.client.rpc(fn);
    } catch {
      throw new Error(OFFLINE);
    }
    if (result.error) {
      const outcome = classify(null, result.error, result.status);
      throw new Error(outcome.kind === 'refused' || outcome.kind === 'unknown' ? outcome.message : CONFLICT);
    }
    return result.data as T;
  }

  /**
   * Refuses: nothing is kept on the device to remove, and erasing the plan is
   * an explicit save (start over sends `reset`), never a side effect. Reporting
   * success here would tell a caller its data was removed when it wasn't.
   */
  async clear(): Promise<void> {
    throw new Error(CLEAR_UNSUPPORTED);
  }
}

/**
 * Requests that belong to one account. Every call made through the returned
 * client is marked with `ownerId`; `ownerGuardFetch` sends it only with that
 * account's token. The browser keeps one Supabase session shared by all its
 * tabs, so when another tab signs in as someone else, this account's
 * remaining saves would otherwise go out under the new account's token.
 */
export const OWNER_HEADER = 'x-financial-os-owner';
/** A supabase-js client's `rpc`, whose request can carry an extra header. */
interface MarkableRpc {
  rpc(fn: string, args?: Record<string, unknown>): { setHeader(name: string, value: string): PromiseLike<{ data: unknown; error: RpcError | null; status: number }> };
}
export function ownerBound(client: MarkableRpc, ownerId: string): RpcClient {
  return { rpc: (fn, args) => client.rpc(fn, args).setHeader(OWNER_HEADER, ownerId) };
}

/** The user id (`sub`) in a bearer token, or null when there is none (a signed-out request carries only the public key). */
export function tokenUser(authorization: string | null): string | null {
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * fetch for the Supabase client. A request marked with its owner goes out
 * only if its token is that owner's; with another account's token it is
 * stopped here, before reaching the server (status 401, code FO401). The mark
 * itself never leaves the device. A request with no user token goes out, and
 * the server refuses it as signed out.
 */
export function ownerGuardFetch(base: typeof fetch = (...args) => fetch(...args)): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const owner = request.headers.get(OWNER_HEADER);
    if (!owner) return base(request);
    const headers = new Headers(request.headers);
    headers.delete(OWNER_HEADER);
    const user = tokenUser(headers.get('authorization'));
    if (user !== null && user !== owner) {
      return new Response(JSON.stringify({ code: 'FO401', message: 'Another account is signed in on this device.', details: null, hint: null }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    return base(new Request(request, { headers }));
  };
}

