import { DimtsAssistant } from "./index.js";
import type { DimtsApi } from "./public-api.js";
import { applyThemeGuard } from "./theme.js";

// Keep the direct module/custom-element contract alongside the optional loader.
export { DimtsAssistant };

const installs = new WeakSet<HTMLScriptElement>();

/** Removing the installing script is the specified uninstall operation (FR-INT-11). */
export function installEmbed(script: HTMLScriptElement): void {
  if (
    installs.has(script) ||
    !script.isConnected ||
    document.querySelector("dimts-embed")
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
  const host = document.createElement("dimts-embed");
  host.dataset.position = script.dataset.position === "start" ? "start" : "end";
  host.dataset.theme = ["dark", "contrast"].includes(script.dataset.theme ?? "")
    ? script.dataset.theme
    : "light";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  if (script.nonce) style.nonce = script.nonce;
  style.textContent = `
    :host{position:fixed;inset-block-end:1rem;inset-inline-end:1rem;z-index:2147483000;display:block;max-inline-size:calc(var(--dimts-viewport-inline,100vw) - 2rem);font:18px/1.5 var(--dimts-font-family,system-ui,sans-serif);color:var(--dimts-text)}
    :host([data-position=start]){inset-inline-start:1rem;inset-inline-end:auto}
    :host([lang=am]){font-family:"Noto Sans Ethiopic",var(--dimts-font-family,system-ui,sans-serif);line-height:1.65}
    *{box-sizing:border-box} [hidden]{display:none!important}
    button{font:inherit;color:var(--dimts-text);background:var(--dimts-surface);border:2px solid var(--dimts-border);border-radius:var(--dimts-radius);min-block-size:48px;min-inline-size:48px;padding:.625rem .875rem;cursor:pointer;overflow-wrap:anywhere}
    button:focus-visible{outline:3px solid var(--dimts-focus);outline-offset:2px;box-shadow:0 0 0 2px var(--dimts-surface)}
    #dimts-panel{inline-size:min(26rem,calc(var(--dimts-viewport-inline,100vw) - 2rem));max-block-size:calc(var(--dimts-viewport-block,100dvh) - 2rem);overflow:auto;background:var(--dimts-surface);border:2px solid var(--dimts-border);border-radius:var(--dimts-radius)}
    #dimts-close{display:block;margin-block:.5rem;margin-inline:auto .5rem}
    dimts-assistant{display:block} @media(max-width:599px){:host{inset-block-end:0;inset-inline-end:0;max-inline-size:var(--dimts-viewport-inline,100vw)}:host([data-position=start]){inset-inline-start:0}#dimts-panel{inline-size:var(--dimts-viewport-inline,100vw);max-block-size:var(--dimts-viewport-block,100dvh);border-radius:0}}
    @media(prefers-reduced-motion:reduce){*{animation:none;transition:none}}
  `;
  root.append(style);
  const launcher = document.createElement("button");
  launcher.id = "dimts-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "dimts-panel");
  const panel = document.createElement("section");
  panel.id = "dimts-panel";
  panel.hidden = true;
  const close = document.createElement("button");
  close.id = "dimts-close";
  close.type = "button";
  const widget = new DimtsAssistant();
  for (const attribute of [
    "data-host-key",
    "data-lang",
    "data-theme",
    "data-position",
    "data-simple",
    "data-api",
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
    close.textContent = widget.uiText("embed.close");
    panel.setAttribute("aria-label", widget.uiText("embed.open"));
    host.lang = widget.uiLanguage;
    host.dir = widget.dir || "ltr";
  };
  const emit = (name: "dimts:opened" | "dimts:closed") =>
    widget.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true }),
    );
  let open = false;
  const api: DimtsApi = {
    open() {
      if (open) return;
      open = true;
      widget.hidden = false;
      panel.hidden = false;
      launcher.hidden = true;
      launcher.setAttribute("aria-expanded", "true");
      close.focus();
      emit("dimts:opened");
    },
    close() {
      if (!open) return;
      open = false;
      panel.hidden = true;
      widget.hidden = true;
      launcher.hidden = false;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
      emit("dimts:closed");
    },
    setLanguage: (code) => widget.setLanguage(code),
    escalate() {
      api.open();
      widget.escalate();
    },
  };
  launcher.addEventListener("click", api.open);
  close.addEventListener("click", api.close);
  widget.addEventListener("dimts:ready", labels);
  widget.addEventListener("dimts:language", labels);
  window.Dimts = api;
  document.body.append(host);
  // CSS page zoom scales fixed descendants without reducing viewport units.
  // Clamp to the visible viewport in the host's local coordinate system.
  const fitViewport = () => {
    const scale =
      Math.round(
        (host.getBoundingClientRect().width / host.offsetWidth || 1) * 100,
      ) / 100;
    for (const [property, size] of [
      ["--dimts-viewport-inline", window.innerWidth],
      ["--dimts-viewport-block", window.innerHeight],
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
      "--dimts-surface",
      "--dimts-text",
      "--dimts-muted",
      "--dimts-primary",
      "--dimts-primary-text",
      "--dimts-border",
      "--dimts-focus",
      "--dimts-font-family",
      "--dimts-radius",
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
    widget.removeEventListener("dimts:ready", labels);
    widget.removeEventListener("dimts:language", labels);
    host.remove();
    widget.clearOwnedStorage();
    if (window.Dimts === api) delete window.Dimts;
    installs.delete(script);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
