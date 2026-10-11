import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatMoney } from '../../domain/money';
import type { OccurrenceStatus, TransactionKind } from '../../domain/types';

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
              <span aria-hidden="true">{t.tone === 'success' ? '✓' : '!'}</span> {t.message}
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
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
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
const STATUS_ICON: Record<OccurrenceStatus, string> = {
  scheduled: '○',
  overdue: '!',
  completed: '✓',
  canceled: '⊘',
};

export function StatusBadge({ status, kind }: { status: OccurrenceStatus; kind?: TransactionKind }) {
  let label = STATUS_LABEL[status];
  if (status === 'completed' && kind) label = kind === 'income' ? 'Received' : 'Paid';
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span> {label}
    </span>
  );
}

export function KindTag({ kind }: { kind: TransactionKind }) {
  const label = kind === 'income' ? 'Money in' : kind === 'liability' ? 'Liability' : 'Expense';
  return <span className={`kind-tag kind-${kind}`}>{label}</span>;
}

/** Amount with an explicit +/− sign by direction. */
export function FlowAmount({ kind, cents, strike }: { kind: TransactionKind; cents: number; strike?: boolean }) {
  const sign = kind === 'income' ? '+' : '−';
  const text = `${sign}${formatMoney(cents)}`;
  return (
    <span className={`amount amount-${kind === 'income' ? 'in' : 'out'}${strike ? ' strike' : ''}`}>
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
      <span aria-hidden="true">! </span>
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
