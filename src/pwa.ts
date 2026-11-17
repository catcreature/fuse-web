// The installable side: the service worker (offline copy, public/sw.js) and system notifications through it.

/** Registers public/sw.js in a production build. Never throws; a failure is only logged. */
export function registerWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI)).catch((e) => {
      console.warn('Fuse: service worker not registered', e);
    });
  } catch (e) {
    console.warn('Fuse: service worker not registered', e);
  }
}

/** A system notification, when allowed. Through the service worker where there is one (the only way on
 *  Android Chrome), else the page's own Notification. The same tag replaces an earlier one. Never throws. */
export async function notify(body: string, tag: string): Promise<void> {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification('Fuse', { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
      return;
    }
  } catch (e) {
    console.warn('Fuse: worker notification failed', e);
  }
  try {
    new Notification('Fuse', { body, tag });
  } catch {
    // Refused (Android Chrome without a worker): the banner already showed it.
  }
}
