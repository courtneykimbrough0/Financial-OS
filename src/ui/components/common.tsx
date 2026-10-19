import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Ban, Banknote, Check, CircleDashed, CreditCard, PiggyBank, Receipt, Repeat, ShoppingBag, Tag, X, type LucideIcon } from 'lucide-react';
import { formatMoney } from '../../domain/money';
import { doneVerb, KIND_LABEL, signFor, type OccurrenceStatus, type TransactionKind } from '../../domain/types';

// ---------------------------------------------------------------------------
// Icons: one line-icon set (Lucide) at one stroke weight, always decorative
// unless given a label.
// ---------------------------------------------------------------------------

export function Icon({ icon: I, size = 20, label, className }: { icon: LucideIcon; size?: number; label?: string; className?: string }) {
  return <I size={size} strokeWidth={1.75} className={className} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} focusable={false} />;
}

export const KIND_ICON: Record<TransactionKind, LucideIcon> = {
  income: Banknote,
  bill: Receipt,
  subscription: Repeat,
  liability: CreditCard,
  reserve: PiggyBank,
  varied: ShoppingBag,
};

/** Round leading avatar for a transaction, colored and shaped by kind. */
export function KindAvatar({ kind, size = 'md' }: { kind: TransactionKind; size?: 'sm' | 'md' }) {
  return (
    <span className={`avatar avatar-${kind} avatar-${size}`} aria-hidden="true">
      <Icon icon={KIND_ICON[kind]} size={size === 'sm' ? 14 : 18} />
    </span>
  );
}

/** Small uppercase label that introduces a group of cards. */
export function SectionLabel({ id, children, action }: { id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-label-row">
      <h2 className="section-label" id={id}>
        {children}
      </h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts (confirmation feedback, announced to screen readers)
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const notify = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-1), { id, message, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.tone}`}>
              <Icon icon={t.tone === 'success' ? Check : AlertCircle} size={18} /> {t.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------------------
// Modal sheet
// ---------------------------------------------------------------------------

let openModals = 0;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusable = () =>
      el ? Array.from(el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => !x.hasAttribute('disabled')) : [];
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const items = focusable();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    // Hide the page behind the dialog from keyboard and assistive tech.
    const appRoot = document.getElementById('root');
    openModals++;
    appRoot?.setAttribute('inert', '');
    return () => {
      document.removeEventListener('keydown', onKey);
      openModals--;
      if (openModals === 0) {
        document.body.classList.remove('modal-open');
        appRoot?.removeAttribute('inert');
      }
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <span className="sheet-grabber" aria-hidden="true" />
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon icon={X} size={22} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Status and amount display (never color alone: always a word or symbol too)
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  scheduled: 'Expected',
  overdue: 'Overdue',
  completed: 'Done',
  canceled: 'Canceled',
};
const STATUS_ICON: Record<OccurrenceStatus, LucideIcon> = {
  scheduled: CircleDashed,
  overdue: AlertCircle,
  completed: Check,
  canceled: Ban,
};

export function StatusBadge({ status, kind, release }: { status: OccurrenceStatus; kind?: TransactionKind; release?: true }) {
  let label = STATUS_LABEL[status];
  if (status === 'completed' && kind) label = doneVerb({ kind, release }).replace(/^./, (c) => c.toUpperCase());
  return (
    <span className={`badge badge-${status}`}>
      <Icon icon={STATUS_ICON[status]} size={13} /> {label}
    </span>
  );
}

export function KindTag({ kind }: { kind: TransactionKind }) {
  const label = kind === 'income' ? 'Money in' : kind === 'liability' ? 'Liability' : KIND_LABEL[kind];
  return <span className={`kind-tag kind-${kind}`}>{label}</span>;
}

/** User-created tags shown as small pills. Renders nothing when there are none. */
export function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="tag-list">
      <span className="sr-only">Tags: </span>
      {tags.map((t) => (
        <span key={t} className="tag">
          <Icon icon={Tag} size={11} />
          {t}
        </span>
      ))}
    </span>
  );
}

/** Amount with an explicit +/− sign by direction. */
/** An item's amount, signed by its effect on available cash. Reserves have their own color: the money stays the person's. */
export function FlowAmount({ kind, cents, strike, release }: { kind: TransactionKind; cents: number; strike?: boolean; release?: true }) {
  const sign = signFor({ kind, release }) === 1 ? '+' : '−';
  const text = `${sign}${formatMoney(cents)}`;
  return (
    <span className={`amount amount-${kind === 'reserve' ? 'reserve' : kind === 'income' ? 'in' : 'out'}${strike ? ' strike' : ''}`}>
      {strike ? <s>{text}</s> : text}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string | null; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode; id?: string }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      {children({ id: fieldId, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert">
      <Icon icon={AlertCircle} size={16} />
      {message}
    </p>
  );
}

export function MoneyInput(props: { id: string; value: string; onChange: (v: string) => void; 'aria-describedby'?: string; 'aria-invalid'?: boolean; autoFocus?: boolean }) {
  const { value, onChange, autoFocus, ...rest } = props;
  return (
    <div className="money-input">
      <span aria-hidden="true">$</span>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        autoFocus={autoFocus}
        data-autofocus={autoFocus ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
