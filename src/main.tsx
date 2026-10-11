import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { LocalStorageAdapter } from './state/storage';
import { StoreProvider } from './state/store';
import { App } from './ui/App';
import { ToastProvider } from './ui/components/common';
import './styles.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider adapter={new LocalStorageAdapter()}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StoreProvider>
  </StrictMode>,
);
