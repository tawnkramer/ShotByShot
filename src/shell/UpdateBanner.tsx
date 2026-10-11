import { useRegisterSW } from 'virtual:pwa-register/react';
import { useProjectStore } from '../state/store';

/**
 * Offers new versions as soon as they're deployed. The app checks whenever
 * it comes back to the foreground, and saves the open project before
 * reloading.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => void registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      setInterval(check, 30 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span className="grow">New version available</span>
      <button className="btn ghost small-btn" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
      <button
        className="btn primary small-btn"
        onClick={async () => {
          await useProjectStore.getState().flush();
          await updateServiceWorker(true);
          // If the page wasn't controlled yet, no controllerchange fires; reload anyway.
          setTimeout(() => location.reload(), 1500);
        }}
      >
        Update
      </button>
    </div>
  );
}
