import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useProjectStore } from '../state/store';

/**
 * Offers new versions as soon as they're deployed. The app checks whenever
 * it comes back to the foreground. A new service worker takes over at once
 * (so no install can get stuck on an old one), which leaves this page running
 * the old code until it reloads; the banner offers that reload, saving the
 * open project first.
 */
export function UpdateBanner() {
  const [replaced, setReplaced] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => void registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      setInterval(check, 30 * 60 * 1000);
    },
  });

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    // The first install also takes control; only a change from an existing worker is an update.
    let hadController = !!sw.controller;
    const onChange = () => {
      if (hadController) setReplaced(true);
      hadController = true;
    };
    sw.addEventListener('controllerchange', onChange);
    return () => sw.removeEventListener('controllerchange', onChange);
  }, []);

  if (!replaced && !needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span className="grow">New version available</span>
      <button
        className="btn ghost small-btn"
        onClick={() => {
          setReplaced(false);
          setNeedRefresh(false);
        }}
      >
        Later
      </button>
      <button
        className="btn primary small-btn"
        onClick={async () => {
          await useProjectStore.getState().flush();
          location.reload();
        }}
      >
        Update
      </button>
    </div>
  );
}
