import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { AccountGate, useAccount, type AuthService } from './state/account';
import { forwardedAuthDomain } from './state/auth-domain';
import { DataModeProvider } from './state/mode';
import { App } from './ui/App';
import { ToastProvider } from './ui/components/common';
import { SignIn } from './ui/screens/SignIn';
import firebaseSettings from '../firebase-applet-config.json';
import '@fontsource-variable/inter';
import './styles.css';

registerSW({ immediate: true });

// Ask the browser to keep this app's storage instead of clearing it when space runs low.
void navigator.storage?.persist?.().catch(() => undefined);

/**
 * Accounts are on when Firebase settings are present, unless the build sets
 * VITE_ACCOUNTS=off (device storage only; used by the end-to-end test and for
 * working on the app without signing in).
 */
const accountsOn = import.meta.env.VITE_ACCOUNTS !== 'off' && Boolean(firebaseSettings.projectId && firebaseSettings.apiKey);

function AppWithData() {
  const account = useAccount();
  return (
    <DataModeProvider adapter={account?.adapter}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>
  );
}

function WithAccounts() {
  const [auth, setAuth] = useState<AuthService | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Firebase is a separate download that only signed-in builds need.
    Promise.all([import('./state/firebase'), forwardedAuthDomain()]).then(
      ([m, authDomain]) => setAuth(m.firebaseAuthService(authDomain ? { ...firebaseSettings, authDomain } : firebaseSettings)),
      () => setFailed(true),
    );
  }, []);
  if (failed) {
    return (
      <div className="load-screen" role="alert">
        <p>Financial OS couldn’t start. Check your connection, then try again.</p>
        <button type="button" className="button primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!auth) {
    return (
      <div className="load-screen" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>Opening Financial OS…</p>
      </div>
    );
  }
  return (
    <AccountGate auth={auth} signIn={(onSignedIn) => <SignIn auth={auth} onSignedIn={onSignedIn} />}>
      <AppWithData />
    </AccountGate>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode>{accountsOn ? <WithAccounts /> : <AppWithData />}</StrictMode>);
