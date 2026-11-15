import { BridgelyAssistant } from "./index.js";
import type { BridgelyApi } from "./public-api.js";
import { applyThemeGuard } from "./theme.js";

// LTI instructor launches use a separate page component while the learner
// widget remains lazy and unchanged on ordinary host pages.
if (document.querySelector("bridgely-insights")) {
  void import("./insights-page.js");
}

// Keep the direct module/custom-element contract alongside the optional loader.
export { BridgelyAssistant };

const installs = new WeakSet<HTMLScriptElement>();

/** Removing the installing script is the specified uninstall operation (FR-INT-11). */
export function installEmbed(script: HTMLScriptElement): void {
  if (
    installs.has(script) ||
    !script.isConnected ||
    document.querySelector("bridgely-embed")
  )
    return;
  if (!document.body) {
    const ready = () => {
      observer.disconnect();
      document.removeEventListener("DOMContentLoaded", ready);
      installEmbed(script);
    };
    const observer = new MutationObserver(() => {
      if (!script.isConnected) {
        observer.disconnect();
        document.removeEventListener("DOMContentLoaded", ready);
      } else if (document.body) ready();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    document.addEventListener("DOMContentLoaded", ready, { once: true });
    return;
  }
  installs.add(script);
  const host = document.createElement("bridgely-embed");
  host.dataset.position = script.dataset.position === "start" ? "start" : "end";
  host.dataset.theme = ["dark", "contrast"].includes(script.dataset.theme ?? "")
    ? script.dataset.theme
    : "light";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  if (script.nonce) style.nonce = script.nonce;
  style.textContent = `
    :host{position:fixed;inset-block-end:1rem;inset-inline-end:1rem;z-index:2147483000;display:block;max-inline-size:calc(var(--Bridgely-viewport-inline,100vw) - 2rem);font:16px/1.5 var(--Bridgely-font-family,system-ui,sans-serif);color:var(--Bridgely-text);--Bridgely-panel-block:min(736px,calc(var(--Bridgely-viewport-block,100dvh) - 32px))}
    :host([data-position=start]){inset-inline-start:1rem;inset-inline-end:auto}
    :host([lang=am]){font-family:"Noto Sans Ethiopic",var(--Bridgely-font-family,system-ui,sans-serif);font-size:17px;line-height:1.65}
    *{box-sizing:border-box} [hidden]{display:none!important}
    button{font:inherit;color:var(--Bridgely-text);background:var(--Bridgely-surface);border:2px solid var(--Bridgely-border);border-radius:var(--Bridgely-radius);min-block-size:48px;min-inline-size:48px;padding:.625rem .875rem;cursor:pointer;overflow-wrap:anywhere}
    button:focus-visible{outline:3px solid var(--Bridgely-focus);outline-offset:2px;box-shadow:0 0 0 2px var(--Bridgely-surface)}
    #Bridgely-launcher{display:inline-flex;align-items:center;gap:.625rem;border:0;border-radius:999px;background:linear-gradient(135deg,var(--Bridgely-primary),color-mix(in srgb,var(--Bridgely-primary) 80%,var(--Bridgely-primary-text)));color:var(--Bridgely-primary-text);font-weight:700;min-block-size:52px;padding-inline:1.125rem 1.5rem;box-shadow:0 10px 28px color-mix(in srgb,var(--Bridgely-primary) 45%,transparent),0 2px 6px rgb(0 0 0/18%);transition:transform .18s ease,box-shadow .18s ease}
    #Bridgely-launcher::before{content:"";inline-size:1.5rem;block-size:1.5rem;flex:none;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'/%3E%3C/svg%3E") center/contain no-repeat}
    #Bridgely-launcher:hover{transform:translateY(-2px);box-shadow:0 14px 34px color-mix(in srgb,var(--Bridgely-primary) 50%,transparent),0 3px 8px rgb(0 0 0/20%)}
    #Bridgely-panel{display:flex;flex-direction:column;inline-size:min(416px,calc(var(--Bridgely-viewport-inline,100vw) - 32px));max-block-size:var(--Bridgely-panel-block);overflow:auto;background:var(--Bridgely-surface);border:1px solid color-mix(in srgb,var(--Bridgely-border) 35%,var(--Bridgely-surface));border-radius:1.25rem;box-shadow:0 24px 64px rgb(0 0 0/26%),0 4px 14px rgb(0 0 0/10%);animation:Bridgely-panel-in .22s cubic-bezier(.2,.8,.2,1)}
    @keyframes Bridgely-panel-in{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
    #Bridgely-panel{position:relative}
    #Bridgely-close{position:absolute;inset-block-start:.75rem;inset-inline-end:.75rem;z-index:5;display:grid;place-items:center;padding:0;border:1px solid color-mix(in srgb,var(--Bridgely-primary-text) 35%,var(--Bridgely-primary));border-radius:50%;background:color-mix(in srgb,var(--Bridgely-primary-text) 12%,var(--Bridgely-primary));color:var(--Bridgely-primary-text);transition:background-color .15s ease}
    #Bridgely-close:hover{background:color-mix(in srgb,var(--Bridgely-primary-text) 24%,var(--Bridgely-primary))}
    #Bridgely-close::before{content:"";inline-size:1.25rem;block-size:1.25rem;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 6l12 12M18 6L6 18' stroke='black' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 6l12 12M18 6L6 18' stroke='black' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat}
    bridgely-assistant{display:block;--Bridgely-help-position:static;--Bridgely-help-order:0;--Bridgely-help-margin:.75rem 1rem 0;--Bridgely-help-z:1;--Bridgely-close-space:3.25rem;--Bridgely-frame-border:0;--Bridgely-frame-radius:0;--Bridgely-frame-shadow:none;--bridgely-embed-height:calc(var(--Bridgely-panel-block) - 2px)} @media(max-width:599px){:host{inset-block-end:0;inset-inline-end:0;max-inline-size:var(--Bridgely-viewport-inline,100vw)}:host([data-position=start]){inset-inline-start:0}#Bridgely-panel{inline-size:var(--Bridgely-viewport-inline,100vw);max-block-size:var(--Bridgely-viewport-block,100dvh);border:0;border-radius:0}bridgely-assistant{--bridgely-embed-height:var(--Bridgely-viewport-block,100dvh)}#Bridgely-launcher{margin:1rem}}
    @media(prefers-reduced-motion:reduce){*{animation:none;transition:none}}
  `;
  root.append(style);
  const launcher = document.createElement("button");
  launcher.id = "Bridgely-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "Bridgely-panel");
  const panel = document.createElement("section");
  panel.id = "Bridgely-panel";
  panel.hidden = true;
  const close = document.createElement("button");
  close.id = "Bridgely-close";
  close.type = "button";
  const widget = new BridgelyAssistant();
  for (const attribute of [
    "data-host-key",
    "data-lang",
    "data-theme",
    "data-position",
    "data-simple",
    "data-api",
    "data-jobs",
  ]) {
    const value = script.getAttribute(attribute);
    if (value !== null) widget.setAttribute(attribute, value);
  }
  if (script.nonce) widget.nonce = script.nonce;
  widget.hidden = true;
  panel.append(close, widget);
  root.append(launcher, panel);
  const labels = () => {
    launcher.textContent = widget.uiText("embed.open");
    close.setAttribute("aria-label", widget.uiText("embed.close"));
    close.title = widget.uiText("embed.close");
    panel.setAttribute("aria-label", widget.uiText("embed.open"));
    host.lang = widget.uiLanguage;
    host.dir = widget.dir || "ltr";
  };
  const emit = (name: "Bridgely:opened" | "Bridgely:closed") =>
    widget.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true }),
    );
  let open = false;
  const api: BridgelyApi = {
    open() {
      if (open) return;
      open = true;
      widget.hidden = false;
      panel.hidden = false;
      launcher.hidden = true;
      launcher.setAttribute("aria-expanded", "true");
      close.focus();
      emit("Bridgely:opened");
    },
    close() {
      if (!open) return;
      open = false;
      panel.hidden = true;
      widget.hidden = true;
      launcher.hidden = false;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
      emit("Bridgely:closed");
    },
    setLanguage: (code) => widget.setLanguage(code),
    escalate() {
      api.open();
      widget.escalate();
    },
  };
  launcher.addEventListener("click", api.open);
  close.addEventListener("click", api.close);
  widget.addEventListener("Bridgely:ready", labels);
  widget.addEventListener("Bridgely:language", labels);
  window.Bridgely = api;
  document.body.append(host);
  // CSS page zoom scales fixed descendants without reducing viewport units.
  // Clamp to the visible viewport in the host's local coordinate system.
  const fitViewport = () => {
    const scale =
      Math.round(
        (host.getBoundingClientRect().width / host.offsetWidth || 1) * 100,
      ) / 100;
    for (const [property, size] of [
      ["--Bridgely-viewport-inline", window.innerWidth],
      ["--Bridgely-viewport-block", window.innerHeight],
    ] as const) {
      const value = `${size / scale}px`;
      if (host.style.getPropertyValue(property) !== value)
        host.style.setProperty(property, value);
    }
  };
  const viewportObserver = new ResizeObserver(fitViewport);
  viewportObserver.observe(document.documentElement);
  viewportObserver.observe(host);
  window.addEventListener("resize", fitViewport);
  fitViewport();
  const releaseTheme = applyThemeGuard(host);
  const inheritTheme = () => {
    for (const property of [
      "--Bridgely-surface",
      "--Bridgely-text",
      "--Bridgely-muted",
      "--Bridgely-primary",
      "--Bridgely-primary-text",
      "--Bridgely-border",
      "--Bridgely-focus",
      "--Bridgely-font-family",
      "--Bridgely-radius",
    ]) {
      const value = host.style.getPropertyValue(property);
      if (widget.style.getPropertyValue(property) !== value)
        widget.style.setProperty(property, value);
    }
  };
  inheritTheme();
  const themeObserver = new MutationObserver(inheritTheme);
  themeObserver.observe(host, { attributes: true, attributeFilter: ["style"] });
  labels();
  let uninstalled = false;
  const observer = new MutationObserver(() => {
    if (script.isConnected || uninstalled) return;
    uninstalled = true;
    observer.disconnect();
    releaseTheme();
    themeObserver.disconnect();
    viewportObserver.disconnect();
    window.removeEventListener("resize", fitViewport);
    launcher.removeEventListener("click", api.open);
    close.removeEventListener("click", api.close);
    widget.removeEventListener("Bridgely:ready", labels);
    widget.removeEventListener("Bridgely:language", labels);
    host.remove();
    widget.clearOwnedStorage();
    if (window.Bridgely === api) delete window.Bridgely;
    installs.delete(script);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
