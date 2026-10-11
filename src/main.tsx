import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { DataModeProvider } from './state/mode';
import { App } from './ui/App';
import { ToastProvider } from './ui/components/common';
import './styles.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataModeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>
  </StrictMode>,
);
