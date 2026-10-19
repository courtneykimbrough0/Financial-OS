/**
 * Accounts: where money is received, held and spent. Optional and secondary:
 * a short list in Settings, an account choice on an item's form, the account
 * on an item's row, and money moved between accounts. Nothing here changes
 * cash flow or the running total. Hidden where the storage can't keep
 * accounts yet (signed in with Firebase, or the Supabase development build);
 * see ACCOUNTS_IN_SIGNED_IN_SAVES.
 */
import { useId, useState, type FormEvent } from 'react';
import { ArrowRight, ChevronRight, Plus, Wallet } from 'lucide-react';
import { accountBalance, accountTransfers, transferShortfall, transfersInRange } from '../../domain/balances';
import { formatMedium, type DateStr } from '../../domain/dates';
import { centsToInput, formatMoney, parseMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPES, accountTypeFor, type Account, type AccountType, type AppData, type TransactionKind, type Transfer } from '../../domain/types';
import { useAccount } from '../../state/account';
import { ACCOUNTS_IN_SIGNED_IN_SAVES } from '../../state/features';
import { useAccountSlot } from '../../state/slots';
import { useStore } from '../../state/store';
import { Field, FormError, Icon, Modal, MoneyInput, useToast } from './common';

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

const nameOf = (data: AppData, id: string) => (data.accounts ?? []).find((a) => a.id === id)?.name ?? 'Account';

/** The Settings section: the person's accounts, adding one, and moving money between them. */
export function AccountsSettings() {
  const { data, today } = useStore();
  const available = useAccountsAvailable();
  const [sheet, setSheet] = useState<{ mode: 'add' } | { mode: 'account'; id: string } | { mode: 'move' } | null>(null);
  if (!available) return null;
  const accounts = data.accounts ?? [];
  const open = sheet?.mode === 'account' ? accounts.find((a) => a.id === sheet.id) : undefined;

  return (
    <section className="card settings-card" aria-labelledby="settings-accounts">
      <h2 id="settings-accounts">Accounts</h2>
      {accounts.length === 0 ? (
        <p>Optional: name the accounts your money moves through, like where your paycheck lands and where bills are paid from.</p>
      ) : (
        <ul className="entry-list account-list">
          {accounts.map((a) => {
            const n = ops.assignedCount(data, a.id);
            const balance = accountBalance(data, a.id, today, today);
            return (
              <li key={a.id}>
                <button type="button" className="entry" onClick={() => setSheet({ mode: 'account', id: a.id })} aria-haspopup="dialog">
                  <span className="entry-main">
                    <span className="entry-title">{a.name}</span>
                    <span className="entry-sub">
                      {ACCOUNT_TYPE_LABEL[a.type]}
                      {n > 0 && ` · ${n === 1 ? '1 item' : `${n} items`}`}
                    </span>
                  </span>
                  {balance && <span className={`entry-side amount${balance.recordedCents < 0 ? ' negative-text' : ''}`}>{formatMoney(balance.recordedCents)}</span>}
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
        {accounts.length >= 2 && (
          <button type="button" className="button small secondary" onClick={() => setSheet({ mode: 'move' })} aria-haspopup="dialog">
            <Icon icon={ArrowRight} size={16} /> Move money
          </button>
        )}
      </div>
      {sheet?.mode === 'add' && (
        <Modal title="Add account" onClose={() => setSheet(null)}>
          <AccountForm onDone={() => setSheet(null)} />
        </Modal>
      )}
      {open && <AccountSheet account={open} onClose={() => setSheet(null)} />}
      {sheet?.mode === 'move' && (
        <Modal title="Move money" onClose={() => setSheet(null)}>
          <TransferForm onDone={() => setSheet(null)} />
        </Modal>
      )}
    </section>
  );
}

/** One account: its name, balance if known, its transfers, and deleting it. */
function AccountSheet({ account, onClose }: { account: Account; onClose: () => void }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'rename' | 'balance' | 'delete' | { transfer: Transfer }>('view');
  const balance = accountBalance(data, account.id, today, today);
  const transfers = accountTransfers(data, account.id);
  const assigned = ops.assignedCount(data, account.id);

  if (mode === 'rename')
    return (
      <Modal title={`Rename ${account.name}`} onClose={() => setMode('view')}>
        <AccountForm account={account} onDone={() => setMode('view')} />
      </Modal>
    );
  if (mode === 'balance')
    return (
      <Modal title={`${account.name} balance`} onClose={() => setMode('view')}>
        <OpeningBalanceForm account={account} onDone={() => setMode('view')} />
      </Modal>
    );
  if (typeof mode === 'object')
    return (
      <Modal title={mode.transfer.status === 'expected' ? 'Planned transfer' : 'Transfer'} onClose={() => setMode('view')}>
        <TransferForm transfer={mode.transfer} onDone={() => setMode('view')} />
      </Modal>
    );
  if (mode === 'delete') {
    const remove = () => {
      const r = run((d, c) => ops.deleteAccount(d, account.id, c));
      if (!r.ok) return toast(r.error, 'error');
      toast(`${account.name} deleted.`);
      onClose();
    };
    return (
      <Modal title={`Delete ${account.name}?`} onClose={() => setMode('view')}>
        <div className="stack">
          <p>{assigned === 0 ? 'Nothing is assigned to it.' : `${assigned === 1 ? '1 item is' : `${assigned} items are`} assigned to it. ${assigned === 1 ? 'It stays' : 'They stay'} in your plan with no account.`}</p>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setMode('view')} data-autofocus>
              Keep it
            </button>
            <button type="button" className="button danger" onClick={remove}>
              Delete
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={account.name} onClose={onClose}>
      <div className="stack">
        <p className="hint">
          {ACCOUNT_TYPE_LABEL[account.type]} account. {TYPE_HINT[account.type]}
        </p>
        {balance ? (
          <dl className="sheet-stats">
            <div>
              <dt>Balance</dt>
              <dd className={balance.recordedCents < 0 ? 'negative' : ''}>{formatMoney(balance.recordedCents)}</dd>
            </div>
          </dl>
        ) : null}
        <div className="settings-actions">
          <button type="button" className="button small secondary" onClick={() => setMode('rename')}>
            Rename
          </button>
          <button type="button" className="button small secondary" onClick={() => setMode('balance')}>
            {account.opening ? 'Change balance' : 'Add balance'}
          </button>
          {transfers.length === 0 && (
            <button type="button" className="button small secondary" onClick={() => setMode('delete')}>
              Delete
            </button>
          )}
        </div>
        {account.opening && <p className="hint">From {formatMoney(account.opening.amountCents)} on {formatMedium(account.opening.date)}, with what you’ve recorded since.</p>}
        {transfers.length > 0 && (
          <section className="stack-sm" aria-label="Transfers">
            <h3 className="subhead">Transfers</h3>
            <ul className="entry-list card">
              {transfers.map((t) => (
                <li key={t.id}>
                  <TransferRow transfer={t} onOpen={() => setMode({ transfer: t })} />
                </li>
              ))}
            </ul>
            <p className="hint">To delete this account, delete or change its transfers first.</p>
          </section>
        )}
      </div>
    </Modal>
  );
}

/** "Paycheck account → Reserves", amount, date and whether it happened. */
export function TransferRow({ transfer: t, onOpen }: { transfer: Transfer; onOpen: () => void }) {
  const { data, today } = useStore();
  const short = t.status === 'expected' ? transferShortfall(data, t.id, today) : null;
  const status = t.status === 'recorded' ? 'Moved' : t.date <= today ? 'Not recorded' : 'Planned';
  return (
    <button type="button" className="entry" onClick={onOpen} aria-haspopup="dialog">
      <span className="avatar avatar-transfer avatar-sm" aria-hidden="true">
        <Icon icon={ArrowRight} size={14} />
      </span>
      <span className="entry-main">
        <span className="entry-title">
          {nameOf(data, t.fromAccountId)} → {nameOf(data, t.toAccountId)}
        </span>
        <span className="entry-sub">
          {formatMedium(t.date)} · {status}
        </span>
        {short ? <span className="entry-sub negative-text">Leaves {nameOf(data, t.fromAccountId)} {formatMoney(short)} short</span> : null}
      </span>
      <span className="entry-side amount">{formatMoney(t.amountCents)}</span>
      <Icon icon={ChevronRight} size={18} className="chevron" />
    </button>
  );
}

/**
 * Move money between two accounts, or plan to. Editing an expected transfer
 * can record it; editing a recorded one corrects it. It never changes cash
 * flow, and nothing moves at a bank.
 */
export function TransferForm({ transfer, onDone }: { transfer?: Transfer; onDone: () => void }) {
  const { data, run, today } = useStore();
  const toast = useToast();
  const id = useId();
  const accounts = data.accounts ?? [];
  const [from, setFrom] = useState(transfer?.fromAccountId ?? accounts.find((a) => a.type === 'income')?.id ?? accounts[0]?.id ?? '');
  const [to, setTo] = useState(transfer?.toAccountId ?? (accounts.find((a) => a.id !== from && a.type !== 'income') ?? accounts.find((a) => a.id !== from))?.id ?? '');
  const [amount, setAmount] = useState(transfer ? centsToInput(transfer.amountCents) : '');
  const [date, setDate] = useState<DateStr>(transfer?.date ?? today);
  const [status, setStatus] = useState<Transfer['status']>(transfer?.status ?? 'recorded');
  const [error, setError] = useState<string | null>(null);

  const input = (): ops.TransferInput | null => {
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) {
      setError('Enter an amount greater than $0.');
      return null;
    }
    return { fromAccountId: from, toAccountId: to, amountCents: cents, date };
  };
  const finish = (r: ops.Result, message: string) => {
    if (!r.ok) return setError(r.error);
    toast(message);
    onDone();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const i = input();
    if (!i) return;
    if (!transfer) return finish(run((d, c) => ops.addTransfer(d, i, status, c)), status === 'recorded' ? 'Transfer recorded.' : 'Transfer planned.');
    finish(run((d, c) => ops.updateTransfer(d, transfer.id, i, c)), 'Transfer saved.');
  };
  const record = () => {
    const i = input();
    if (!i || !transfer) return;
    finish(run((d, c) => ops.recordTransfer(d, transfer.id, { amountCents: i.amountCents, date: i.date > today ? today : i.date }, c)), 'Transfer recorded.');
  };
  const remove = () => {
    if (transfer) finish(run((d) => ops.deleteTransfer(d, transfer.id)), 'Transfer deleted.');
  };

  const select = (value: string, onChange: (v: string) => void) => (p: { id: string }) => (
    <select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

  return (
    <form onSubmit={submit} noValidate className="stack">
      {!transfer && (
        <fieldset className="choice-field">
          <legend className="sr-only">Moved or planned</legend>
          <div className="choice-pills">
            {(
              [
                ['recorded', 'Already moved'],
                ['expected', 'Planned'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={`choice-pill${status === value ? ' selected' : ''}`}>
                <input type="radio" name={`${id}-status`} checked={status === value} onChange={() => setStatus(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="From">{select(from, setFrom)}</Field>
      <Field label="To">{select(to, setTo)}</Field>
      <Field label="Amount">{(p) => <MoneyInput {...p} value={amount} onChange={setAmount} autoFocus={!transfer} />}</Field>
      <Field label="Date">{(p) => <input {...p} type="date" max={status === 'recorded' ? today : undefined} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <FormError message={error} />
      <div className="form-actions">
        {transfer ? (
          <button type="button" className="button secondary" onClick={remove}>
            Delete
          </button>
        ) : (
          <button type="button" className="button secondary" onClick={onDone}>
            Cancel
          </button>
        )}
        {transfer?.status === 'expected' && (
          <button type="button" className="button secondary" onClick={record}>
            Record as moved
          </button>
        )}
        <button type="submit" className="button primary">
          {transfer ? 'Save' : status === 'recorded' ? 'Record transfer' : 'Plan transfer'}
        </button>
      </div>
    </form>
  );
}

/** What the account held at the end of a day (optional; balances are shown only once there is one). */
function OpeningBalanceForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const { run, today } = useStore();
  const toast = useToast();
  const [amount, setAmount] = useState(account.opening ? centsToInput(account.opening.amountCents) : '');
  const [date, setDate] = useState<DateStr>(account.opening?.date ?? today);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter a balance, like 1250 or -40.');
    const r = run((d, c) => ops.setOpeningBalance(d, account.id, { amountCents: cents, date }, c));
    if (!r.ok) return setError(r.error);
    toast('Balance saved.');
    onDone();
  };
  const clear = () => {
    const r = run((d, c) => ops.setOpeningBalance(d, account.id, null, c));
    if (!r.ok) return setError(r.error);
    toast('Balance removed.');
    onDone();
  };
  return (
    <form onSubmit={submit} noValidate className="stack">
      <Field label="Balance" hint="What the account held at the end of this day.">
        {(p) => <MoneyInput {...p} value={amount} onChange={setAmount} autoFocus />}
      </Field>
      <Field label="On">{(p) => <input {...p} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <FormError message={error} />
      <div className="form-actions">
        {account.opening ? (
          <button type="button" className="button secondary" onClick={clear}>
            Remove balance
          </button>
        ) : (
          <button type="button" className="button secondary" onClick={onDone}>
            Cancel
          </button>
        )}
        <button type="submit" className="button primary">
          Save
        </button>
      </div>
    </form>
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

/** The item's account on its row, when it has one. */
export function AccountLabel({ accountId }: { accountId?: string }) {
  const { data } = useStore();
  const available = useAccountsAvailable();
  const account = accountId ? (data.accounts ?? []).find((a) => a.id === accountId) : undefined;
  if (!available || !account) return null;
  return (
    <span className="account-label">
      <Icon icon={Wallet} size={12} />
      <span className="sr-only">Account: </span>
      {account.name}
    </span>
  );
}

/** Transfers on one day, for the day sheet. They move money between accounts and don't change the day's totals. */
export function DayTransfers({ date }: { date: DateStr }) {
  const { data } = useStore();
  const available = useAccountsAvailable();
  const [open, setOpen] = useState<Transfer | null>(null);
  const list = transfersInRange(data, date, date);
  if (!available || list.length === 0) return null;
  return (
    <section className="stack-sm" aria-label="Transfers">
      <h3 className="subhead">Transfers between your accounts</h3>
      {open ? (
        <TransferForm transfer={open} onDone={() => setOpen(null)} />
      ) : (
        <ul className="entry-list">
          {list.map((t) => (
            <li key={t.id}>
              <TransferRow transfer={t} onOpen={() => setOpen(t)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
