import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { AccountGate, supabaseAuth, supabaseConfig, useAccount } from './state/account';
import { DataModeProvider } from './state/mode';
import { App } from './ui/App';
import { ToastProvider } from './ui/components/common';
import { SignIn } from './ui/screens/SignIn';
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

function Root() {
  const auth = useMemo(() => (config ? supabaseAuth(config) : null), []);
  // Without Supabase settings the app runs on device storage only.
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
