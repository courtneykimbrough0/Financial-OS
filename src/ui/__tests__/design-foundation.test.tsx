import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyLine, FlowAmount, ListGroup, SectionLabel, StatusBadge } from '../components/common';

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('D1 color roles (PRODUCT_EXPERIENCE.md §7.2)', () => {
  it('money out is neutral text with a "−"; indigo stays the accent', () => {
    expect(css).toMatch(/--color-out: var\(--color-text\);/);
    expect(css).toMatch(/--color-accent: #8a97ff;/);
    render(<FlowAmount kind="bill" cents={6000} />);
    const amount = screen.getByText('−$60.00');
    expect(amount).toHaveClass('amount', 'amount-out');
  });

  it('only money that came in is marked done in green; other done states are neutral, and every badge has a word', () => {
    render(
      <>
        <StatusBadge status="completed" kind="income" />
        <StatusBadge status="completed" kind="bill" />
        <StatusBadge status="completed" kind="reserve" />
        <StatusBadge status="overdue" kind="bill" />
      </>,
    );
    expect(screen.getByText('Received').closest('.badge')).toHaveClass('badge-completed', 'badge-in');
    expect(screen.getByText('Paid').closest('.badge')).not.toHaveClass('badge-in');
    expect(screen.getByText('Set aside').closest('.badge')).not.toHaveClass('badge-in');
    expect(screen.getByText('Overdue').closest('.badge')).toHaveClass('badge-overdue');
  });
});

describe('D1 type and section labels (§7.1)', () => {
  it('uses the type scale tokens', () => {
    expect(css).toMatch(/--text-display: 2\.25rem;/);
    expect(css).toMatch(/--text-section: 0\.9375rem;/);
  });

  it('section labels are sentence-case headings, not uppercase', () => {
    expect(rule('.section-label')).toContain('font-size: var(--text-section)');
    expect(rule('.section-label')).not.toContain('uppercase');
    expect(rule('.subhead')).not.toContain('uppercase');
    render(<SectionLabel id="s">Recurring income</SectionLabel>);
    expect(screen.getByRole('heading', { level: 2, name: 'Recurring income' })).toHaveClass('section-label');
  });
});

describe('D1 shared components', () => {
  it('ListGroup puts related rows on one surface, as a list', () => {
    render(
      <ListGroup label="Recorded">
        <li>Rent</li>
        <li>Phone</li>
      </ListGroup>,
    );
    const list = screen.getByRole('list', { name: 'Recorded' });
    expect(list).toHaveClass('list-group');
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Rent', 'Phone']);
    expect(rule('.list-group > li + li')).toContain('border-top: 1px solid var(--color-border)');
  });

  it('EmptyLine is one line of text and at most one action, with no heading or card', () => {
    render(<EmptyLine action={<button type="button">Add bill</button>}>Add regular bills like rent.</EmptyLine>);
    const line = screen.getByText('Add regular bills like rent.').closest('.empty-line')!;
    expect(line.querySelectorAll('p')).toHaveLength(1);
    expect(within(line as HTMLElement).getAllByRole('button')).toHaveLength(1);
    expect(line.querySelector('h1, h2, h3')).toBeNull();
    expect(line).not.toHaveClass('card');
  });
});
