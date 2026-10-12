import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DataModeProvider } from '../../state/mode';
import { App } from '../App';
import { ToastProvider } from '../components/common';
import { announceUpdate } from '../update';

describe('new version available', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });

  it('waits for a tap instead of reloading on its own', async () => {
    const user = userEvent.setup();
    let applied = 0;
    render(
      <DataModeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DataModeProvider>,
    );
    await screen.findByRole('heading', { name: 'See your cash flow ahead of time' });
    expect(screen.queryByText(/new version/)).toBeNull();

    act(() => announceUpdate(() => (applied += 1)));
    expect(await screen.findByText(/A new version of Financial OS is ready/)).toBeInTheDocument();
    expect(applied).toBe(0);

    await user.click(screen.getByRole('button', { name: /Update/ }));
    expect(applied).toBe(1);
  });
});
