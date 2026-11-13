import type { Plugin } from "vite";

const simulatorAssets = new Set([
  "/dimts-sms-simulator.js",
  "/NotoSansEthiopic-ethiopic-400-normal.woff2",
  "/NotoSansEthiopic-ethiopic-700-normal.woff2",
]);

/** Library-mode preview does not resolve a directory URL to index.html. */
export function simulatorAssetPath(
  url: string | undefined,
  development: boolean,
): string | undefined {
  if (url === undefined) return url;
  const path = url.split("?", 1)[0]!;
  const query = url.slice(path.length);
  if (["/sim/sms", "/sim/sms/", "/sim/sms/index.html"].includes(path))
    return `${development ? "/dist" : ""}/sim/sms/index.html${query}`;
  if (development && simulatorAssets.has(path)) return `/dist${url}`;
  return url;
}

export function smsPagePlugin(): Plugin {
  return {
    name: "dimts-sms-page-route",
    apply: "serve",
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        const rewritten = simulatorAssetPath(request.url, false);
        if (rewritten !== undefined) request.url = rewritten;
        next();
      });
    },
    configureServer(server) {
      // The standalone simulator is separately built; serve those same artifacts.
      server.middlewares.use((request, _response, next) => {
        const rewritten = simulatorAssetPath(request.url, true);
        if (rewritten !== undefined) request.url = rewritten;
        next();
      });
    },
  };
}
