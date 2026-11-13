// Classic asynchronous entry: currentScript is available before the module import.
// No global variable is created by this IIFE bundle.
(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement) || !script.src) return;
  const diagnostics = [
    "reactiveElementVersions",
    "litHtmlVersions",
    "litElementVersions",
    "litIssuedWarnings",
  ];
  const existing = new Set(
    diagnostics.filter((name) => Object.hasOwn(window, name)),
  );
  const removeOwnedDiagnostics = () => {
    for (const name of diagnostics)
      if (!existing.has(name)) Reflect.deleteProperty(window, name);
  };
  const moduleUrl = new URL("./dimts-widget.js", script.src);
  void import(/* @vite-ignore */ moduleUrl.href).then(
    (module: { installEmbed(script: HTMLScriptElement): void }) => {
      // Lit publishes optional version diagnostics. Keep host-owned diagnostics,
      // but the embedding contract adds only the documented Dimts API global.
      removeOwnedDiagnostics();
      if (script.isConnected) module.installEmbed(script);
    },
    () => {
      removeOwnedDiagnostics();
      // Hosts can detect a failed module download without exposing user data.
      script.dispatchEvent(new Event("error"));
    },
  );
})();
