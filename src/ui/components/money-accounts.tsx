/**
 * Accounts: where money is received, held and spent. Optional and secondary:
 * a short list in Settings, and an account choice on an item's form. Nothing
 * here changes the forecast. Hidden where the storage can't keep accounts yet
 * (signed in with Firebase, or the Supabase development build); see
 * ACCOUNTS_IN_SIGNED_IN_SAVES.
 */
import { useId, useState, type FormEvent } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import * as ops from '../../domain/operations';
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPES, accountTypeFor, type Account, type AccountType, type AppData, type TransactionKind } from '../../domain/types';
import { useAccount } from '../../state/account';
import { ACCOUNTS_IN_SIGNED_IN_SAVES } from '../../state/features';
import { useAccountSlot } from '../../state/slots';
import { useStore } from '../../state/store';
import { Field, FormError, Icon, Modal, useToast } from './common';

/** What each type is for, shown under the type choice. */
const TYPE_HINT: Record<AccountType, string> = {
  income: 'Where income arrives. Moves money to your other accounts.',
  distribution: 'Moves money between your accounts, or builds reserves. Makes no outside payments.',
  payment: 'Pays bills, subscriptions, liabilities and everyday spending.',
};

/** Whether accounts can be kept by the storage in use. */
export function useAccountsAvailable(): boolean {
  const account = useAccount();
  const slot = useAccountSlot();
  return !slot && (!account || ACCOUNTS_IN_SIGNED_IN_SAVES);
}

function itemCount(data: AppData, accountId: string): number {
  return data.sources.filter((s) => s.accountId === accountId).length + data.records.filter((r) => r.accountId === accountId).length;
}

/** The Settings section: the person's accounts, adding one, and renaming one. */
export function AccountsSettings() {
  const { data } = useStore();
  const available = useAccountsAvailable();
  const [sheet, setSheet] = useState<{ mode: 'add' } | { mode: 'rename'; account: Account } | null>(null);
  if (!available) return null;
  const accounts = data.accounts ?? [];

  return (
    <section className="card settings-card" aria-labelledby="settings-accounts">
      <h2 id="settings-accounts">Accounts</h2>
      {accounts.length === 0 ? (
        <p>Optional: name the accounts your money moves through, like where your paycheck lands and where bills are paid from.</p>
      ) : (
        <ul className="entry-list account-list">
          {accounts.map((a) => {
            const n = itemCount(data, a.id);
            return (
              <li key={a.id}>
                <button type="button" className="entry" onClick={() => setSheet({ mode: 'rename', account: a })} aria-haspopup="dialog">
                  <span className="entry-main">
                    <span className="entry-title">{a.name}</span>
                    <span className="entry-sub">
                      {ACCOUNT_TYPE_LABEL[a.type]}
                      {n > 0 && ` · ${n === 1 ? '1 item' : `${n} items`}`}
                    </span>
                  </span>
                  <Icon icon={ChevronRight} size={18} className="chevron" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="settings-actions">
        <button type="button" className="button small secondary" onClick={() => setSheet({ mode: 'add' })} aria-haspopup="dialog">
          <Icon icon={Plus} size={16} /> Add account
        </button>
      </div>
      {sheet?.mode === 'add' && (
        <Modal title="Add account" onClose={() => setSheet(null)}>
          <AccountForm onDone={() => setSheet(null)} />
        </Modal>
      )}
      {sheet?.mode === 'rename' && (
        <Modal title={`Rename ${sheet.account.name}`} onClose={() => setSheet(null)}>
          <AccountForm account={sheet.account} onDone={() => setSheet(null)} />
        </Modal>
      )}
    </section>
  );
}

/** Add an account (name and type), or rename one (its type stays). */
function AccountForm({ account, onDone }: { account?: Account; onDone: () => void }) {
  const { run } = useStore();
  const toast = useToast();
  const id = useId();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType | undefined>(account?.type);
  const [error, setError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!account && !type) return setTypeError('Choose a type.');
    const result = account ? run((d, clock) => ops.renameAccount(d, account.id, name, clock)) : run((d, clock) => ops.addAccount(d, { name, type: type! }, clock));
    if (!result.ok) return setError(result.error);
    toast(account ? 'Account renamed.' : 'Account added.');
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate className="stack">
      <Field label="Name">{(p) => <input {...p} type="text" maxLength={ops.MAX_ACCOUNT_NAME} placeholder="e.g. Paycheck account" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />}</Field>
      {account ? (
        <p className="hint">
          {ACCOUNT_TYPE_LABEL[account.type]} account. {TYPE_HINT[account.type]}
        </p>
      ) : (
        <fieldset className="choice-field" aria-describedby={`${id}-hint`} aria-invalid={typeError ? true : undefined}>
          <legend>Type</legend>
          <div className="choice-pills">
            {ACCOUNT_TYPES.map((t) => (
              <label key={t} className={`choice-pill${type === t ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name={`${id}-type`}
                  value={t}
                  checked={type === t}
                  onChange={() => {
                    setType(t);
                    setTypeError(null);
                  }}
                />
                {ACCOUNT_TYPE_LABEL[t]}
              </label>
            ))}
          </div>
          <p className="hint" id={`${id}-hint`}>
            {type ? TYPE_HINT[type] : 'Income, distribution or payment.'}
          </p>
          {typeError && <p className="field-error">{typeError}</p>}
        </fieldset>
      )}
      <FormError message={error} />
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          {account ? 'Save' : 'Add account'}
        </button>
      </div>
    </form>
  );
}

/**
 * The accounts an item of this kind can use, or none. The form shows its
 * account choice only when there is at least one.
 */
export function accountsFor(data: AppData, kind: TransactionKind): Account[] {
  return (data.accounts ?? []).filter((a) => a.type === accountTypeFor(kind));
}

/** Optional account choice on an item's form. Renders nothing when no account suits the item. */
export function AccountSelect({ kind, value, onChange }: { kind: TransactionKind; value: string | null; onChange: (id: string | null) => void }) {
  const { data } = useStore();
  const available = useAccountsAvailable();
  const options = accountsFor(data, kind);
  if (!available || options.length === 0) return null;
  return (
    <Field label="Account (optional)">
      {(p) => (
        <select {...p} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
          <option value="">No account</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
