import type { PlanSection } from '../router';
import { ExpensesScreen, SourcesScreen } from './SourcesScreen';

const SECTIONS: { id: PlanSection; label: string }[] = [
  { id: 'income', label: 'Income' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'liabilities', label: 'Liabilities' },
  { id: 'reserves', label: 'Reserves' },
];

/**
 * Plan: where the six classifications are entered and kept up to date.
 * Each section is the existing screen for it (Expenses holds bills,
 * subscriptions and varied spending); Plan only adds the way between them.
 */
export function Plan({ section }: { section: PlanSection }) {
  return (
    <div className="plan stack-lg">
      <nav className="segmented plan-nav" aria-label="Plan">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/plan/${s.id}`} className={s.id === section ? 'active' : ''} aria-current={s.id === section ? 'page' : undefined}>
            {s.label}
          </a>
        ))}
      </nav>
      {section === 'income' && <SourcesScreen key="income" kind="income" />}
      {section === 'expenses' && <ExpensesScreen key="expenses" />}
      {section === 'liabilities' && <SourcesScreen key="liability" kind="liability" />}
      {section === 'reserves' && <SourcesScreen key="reserve" kind="reserve" />}
    </div>
  );
}
