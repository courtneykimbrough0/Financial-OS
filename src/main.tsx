import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { AccountGate, firebaseAuth, supabaseAuth, supabaseConfig, useAccount } from './state/account';
import { DataModeProvider } from './state/mode';
import { App } from './ui/App';
import { ToastProvider } from './ui/components/common';
import { SignIn } from './ui/screens/SignIn';
import firebaseConfig from '../firebase-applet-config.json';
import '@fontsource-variable/inter';
import './styles.css';

registerSW({ immediate: true });

// Ask the browser to keep this app's storage instead of clearing it when space runs low.
void navigator.storage?.persist?.().catch(() => undefined);

const config = supabaseConfig();

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

function isE2ePreview(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.port === '4179' || window.location.search.includes('e2e=1');
}

function Root() {
  const auth = useMemo(() => {
    if (isE2ePreview()) return null;
    if (firebaseConfig?.projectId && firebaseConfig?.apiKey) {
      return firebaseAuth();
    }
    return config ? supabaseAuth(config) : null;
  }, []);

  if (!auth) return <AppWithData />;
  return (
    <AccountGate auth={auth} signIn={(onSignedIn) => <SignIn auth={auth} onSignedIn={onSignedIn} />}>
      <AppWithData />
    </AccountGate>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
