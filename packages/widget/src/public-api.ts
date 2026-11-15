export interface BridgelyApi {
  open(): void;
  close(): void;
  setLanguage(language: string): void;
  escalate(): void;
}

declare global {
  interface Window {
    Bridgely?: BridgelyApi;
  }
}

interface PublicWidget extends HTMLElement {
  setLanguage(code: string): void;
  escalate(): void;
}

/** Keeps direct custom-element integrations compatible; the script loader owns its instance. */
export function installDefaultApi(): void {
  if (typeof window === "undefined" || window.Bridgely) return;
  const each = (action: (widget: PublicWidget) => void) =>
    document.querySelectorAll<PublicWidget>("bridgely-assistant").forEach(action);
  window.Bridgely = {
    open: () =>
      each((widget) => {
        widget.hidden = false;
        widget.dispatchEvent(
          new CustomEvent("Bridgely:opened", { bubbles: true, composed: true }),
        );
      }),
    close: () =>
      each((widget) => {
        widget.hidden = true;
        widget.dispatchEvent(
          new CustomEvent("Bridgely:closed", { bubbles: true, composed: true }),
        );
      }),
    setLanguage: (code) => each((widget) => widget.setLanguage(code)),
    escalate: () => each((widget) => widget.escalate()),
  };
}
