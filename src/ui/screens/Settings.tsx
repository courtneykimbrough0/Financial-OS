import { useState } from 'react';
import { useAccount } from '../../state/account';
import { useDataMode } from '../../state/mode';
import { useStore } from '../../state/store';
import { AccountActions } from '../components/account';
import { DownloadBackupButton, RestoreBackupButton } from '../components/backup';
import { Modal } from '../components/common';
import { navigate } from '../router';

/** Account, backups, and sample data, in one place instead of the bottom of every screen. */
export function Settings() {
  const { data } = useStore();
  const account = useAccount();
  const { enterSample } = useDataMode();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="stack-lg">
      <header className="screen-header">
        <h1>Settings</h1>
      </header>

      <AccountActions />

      <section className="card settings-card" aria-labelledby="settings-data">
        <h2 id="settings-data">Your data</h2>
        {account ? (
          <p>Your data is saved to your Financial OS account, with a copy on this device so it opens offline. Changes made offline are saved to your account when you reconnect.</p>
        ) : (
          <p>Your data is saved in this browser on this device. Clearing your browser’s site data removes it, so download a backup to keep a copy or to move it to another device.</p>
        )}
        {data.isSample ? (
          <p className="hint">Backups are available for your own data. Leave the sample data to download or restore one.</p>
        ) : (
          <div className="settings-actions">
            <DownloadBackupButton />
            <RestoreBackupButton />
          </div>
        )}
      </section>

      {!data.isSample && (
        <section className="card settings-card" aria-labelledby="settings-sample">
          <h2 id="settings-sample">Sample data</h2>
          <p>Explore a made-up example to see how the forecast works. It’s kept separate from your own data.</p>
          <div className="settings-actions">
            <button type="button" className="button small link" onClick={() => setConfirming(true)}>
              Explore with sample data
            </button>
          </div>
        </section>
      )}

      {confirming && (
        <Modal title="Explore with sample data?" onClose={() => setConfirming(false)}>
          <div className="stack">
            <p>You’ll see a made-up example with a late paycheck, a bill that cost more than expected, an overdue bill, and a stretch where the running total dips below $0.</p>
            <p>Sample data is kept separate from yours. Your own entries stay exactly as they are, and you can return to them anytime with “Leave” on the sample-data banner.</p>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setConfirming(false)} data-autofocus>
                Not now
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  void enterSample().then(() => navigate('dashboard'));
                }}
              >
                Show sample data
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
