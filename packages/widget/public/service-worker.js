const shellCache = "dimts-shell-v1";

globalThis.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const asset = new URL(globalThis.location.href).searchParams.get("asset");
      if (asset && new URL(asset).origin === globalThis.location.origin) {
        await (await globalThis.caches.open(shellCache)).add(asset);
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
  if (
    request.method !== "GET" ||
    url.origin !== globalThis.location.origin ||
    !/\.(?:js|css)$/u.test(url.pathname)
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await globalThis.caches.open(shellCache);
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await globalThis.fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
