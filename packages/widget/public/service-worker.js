const shellCache = "dimts-shell-v3";
const publicCache = "dimts-public-v1";
const configuration = new URL(globalThis.location.href).searchParams;
const asset = configuration.get("asset");
const api = new URL(
  configuration.get("api") || "/v1",
  globalThis.location.href,
);
const assetUrl = asset ? new URL(asset, globalThis.location.href) : null;

function isShell(url) {
  if (url.origin !== globalThis.location.origin) return false;
  const directory = assetUrl ? new URL(".", assetUrl).pathname : "/";
  return (
    url.href === assetUrl?.href ||
    (url.pathname.startsWith(directory) &&
      /\/(?:dimts-[\w-]+\.(?:js|css)|NotoSansEthiopic-ethiopic-(?:400|700)-normal(?:-[\w-]+)?\.woff2)$/u.test(
        url.pathname,
      ))
  );
}

function isPublicData(url) {
  return (
    url.origin === api.origin &&
    url.pathname.startsWith(`${api.pathname.replace(/\/$/u, "")}/`) &&
    /^\/(?:languages|locales\/[^/]+\/(?:ui|faq))$/u.test(
      url.pathname.slice(api.pathname.replace(/\/$/u, "").length),
    )
  );
}

globalThis.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (asset && assetUrl.origin === globalThis.location.origin) {
        const cache = await globalThis.caches.open(shellCache);
        await cache.add(assetUrl.href);
        // Vite emits the static import graph only. Voice and help stay on demand.
        try {
          const response = await globalThis.fetch(
            new URL("dimts-assets.json", assetUrl),
          );
          const manifest = response.ok ? await response.json() : null;
          if (Array.isArray(manifest?.assets)) {
            await Promise.all(
              manifest.assets
                .filter(
                  (name) =>
                    typeof name === "string" &&
                    /^dimts-[\w-]+\.(?:js|css)$/u.test(name),
                )
                .map((name) => cache.add(new URL(name, assetUrl).href)),
            );
          }
        } catch {
          /* The entry remains usable when an older host has no manifest. */
        }
      }
      await globalThis.skipWaiting();
    })(),
  );
});

globalThis.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await globalThis.caches.keys();
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith("dimts-shell-") && name !== shellCache,
          )
          .map((name) => globalThis.caches.delete(name)),
      );
      await globalThis.clients.claim();
    })(),
  );
});

globalThis.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || (!isShell(url) && !isPublicData(url))) {
    return;
  }

  event.respondWith(
    (async () => {
      let cache;
      let cached;
      try {
        cache = await globalThis.caches.open(
          isShell(url) ? shellCache : publicCache,
        );
        // Cache.add() and a module script can differ only in their Origin
        // request header. These same-origin, Dimts-owned build files are public
        // and identical; API representations retain their normal Vary checks.
        cached = await cache.match(request, { ignoreVary: isShell(url) });
      } catch {
        /* Storage-disabled hosts retain the complete network path. */
      }
      try {
        const response = await globalThis.fetch(request);
        if (!response.ok) {
          if (response.status === 404 || response.status === 403) {
            try {
              await cache?.delete(request);
            } catch {
              /* Optional cleanup. */
            }
          }
          return response;
        }
        try {
          await cache?.put(request, response.clone());
        } catch {
          /* Optional offline support. */
        }
        return response;
      } catch (error) {
        if (cached) {
          const headers = new Headers(cached.headers);
          headers.set("X-Dimts-Offline", "1");
          return new Response(cached.body, { status: cached.status, headers });
        }
        throw error;
      }
    })(),
  );
});
