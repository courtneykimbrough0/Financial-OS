import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

// D6: desktop. jsdom has no layout, so the wide-screen rules are read from the stylesheet;
// the browser checks (rail, panel geometry, focus trap, scroll) run in the screenshot script.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
const desktop = () => {
  const start = css.indexOf('/* ---------- Desktop (D6');
  const at = css.indexOf('@media (min-width: 1024px) {', start);
  return css.slice(at, css.indexOf('\n}\n', at));
};

async function open(hash: string) {
  const d = unwrap(ops.completeOnboarding(source(ops.emptyData(), '2026-09-01', 'income', 'Paycheck', 1800, '2026-10-16', { type: 'biweekly' }, 'pay')));
  await new LocalStorageAdapter().save(d, 0);
  window.location.hash = hash;
  render(
    <DataModeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>,
  );
  await screen.findByRole('heading', { level: 1 });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 9, 0));
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

describe('D6 navigation: the same tab bar is the left rail', () => {
  it('there is one tab bar, with the same routes, and it comes before the content so focus follows the rail', async () => {
    await open('#/home');
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    // The top pills (tablet) and the tab bar (phone bottom bar, desktop rail): the same four routes, no third navigation.
    expect(navs).toHaveLength(2);
    for (const nav of navs) expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#/home', '#/forecast', '#/activity', '#/plan/income']);
    const tabBar = document.querySelector('.bottom-nav')!;
    expect(tabBar.compareDocumentPosition(document.getElementById('main')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');
  });

  it('navigating from the tab bar works and marks the current route', async () => {
    const user = await open('#/home');
    const tabBar = document.querySelector('.bottom-nav') as HTMLElement;
    await user.click(within(tabBar).getByRole('link', { name: 'Activity' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument();
    expect(within(tabBar).getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
  });

  it('from 1024px the tab bar is a fixed left rail, the top pills hide and the column centers beside it', () => {
    const d = desktop();
    expect(d).toMatch(/\.top-nav \{\s*display: none;/);
    expect(d).toMatch(/\.bottom-nav \{[^}]*flex-direction: column;[^}]*width: var\(--rail-width\);/);
    expect(d).toMatch(/\.app\.with-nav main \{[^}]*margin-left: calc\(var\(--rail-width\) \+ max\(0px, \(100% - var\(--rail-width\) - 760px\) \/ 2\)\);/);
    // Rail rows keep a 44px target.
    expect(d).toMatch(/\.bottom-nav a \{[^}]*min-height: var\(--tap\);/);
  });

  it('setup has no navigation, so no rail', async () => {
    await new LocalStorageAdapter().save(ops.emptyData(), 0);
    window.location.hash = '#/onboarding';
    render(
      <DataModeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DataModeProvider>,
    );
    await screen.findByRole('heading', { name: 'When do you get paid?' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(document.querySelector('.app')).not.toHaveClass('with-nav');
  });
});

describe('D6 sheets: a panel from the right on desktop', () => {
  it('the same Modal opens as a full-height right panel, with reduced motion respected', () => {
    const d = desktop();
    expect(d).toMatch(/\.modal-backdrop \{\s*align-items: stretch;\s*justify-content: flex-end;/);
    expect(d).toMatch(/\.modal \{[^}]*max-width: 480px;[^}]*max-height: none;/);
    expect(css).toMatch(/@media \(min-width: 1024px\) and \(prefers-reduced-motion: no-preference\) \{\s*\.modal \{\s*animation: panel-in/);
  });

  it('keeps its dialog semantics, focus and Escape (the same component on every width)', async () => {
    const user = await open('#/plan/income');
    const row = screen.getByRole('button', { name: /^Paycheck/ });
    row.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Paycheck' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(row);
  });
});
