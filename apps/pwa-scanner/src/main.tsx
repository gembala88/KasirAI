import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

// Real bug found live: with the default auto-injected registerSW.js, a
// deployed fix could sit inert for 8+ minutes on an already-open device —
// the new service worker installs in the background, but nothing forces
// the current tab off the stale one it's still executing, and a hard
// refresh doesn't bust a Workbox SW cache. Registering here instead lets us
// reload the instant a new service worker actually takes control, so a
// shift that starts before a deploy still ends up on the fix, not stuck on
// old code until someone thinks to clear the cache by hand.
registerSW({ immediate: true });
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  window.location.reload();
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
