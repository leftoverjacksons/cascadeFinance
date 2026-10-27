import { useEffect } from 'react';

const DISMISS_EVENTS = ['ionModalDidDismiss', 'ionAlertDidDismiss', 'ionActionSheetDidDismiss', 'ionPopoverDidDismiss'];
const OPEN_OVERLAY =
  'ion-modal:not(.overlay-hidden), ion-alert:not(.overlay-hidden), ' +
  'ion-action-sheet:not(.overlay-hidden), ion-popover:not(.overlay-hidden)';

/**
 * Ionic hides the page from assistive technology (aria-hidden on the router
 * outlet) while an overlay is open. With nested overlays, e.g. a select's
 * alert inside a modal, it can leave aria-hidden behind after everything is
 * closed, making the whole app invisible to screen readers. Once no overlay
 * is open any more, clear it.
 */
export function useOverlayAriaFix() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.querySelector(OPEN_OVERLAY)) return;
        document.querySelectorAll('ion-router-outlet[aria-hidden="true"]').forEach((el) => {
          el.removeAttribute('aria-hidden');
        });
      }, 50);
    };
    DISMISS_EVENTS.forEach((e) => document.addEventListener(e, check));
    return () => {
      clearTimeout(timer);
      DISMISS_EVENTS.forEach((e) => document.removeEventListener(e, check));
    };
  }, []);
}
