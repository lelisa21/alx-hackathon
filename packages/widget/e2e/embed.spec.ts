import { expect, test, type Page } from "@playwright/test";
import { loadPacks } from "../../locales-tools/src/index.js";
import { resolve } from "node:path";

const packs = loadPacks(resolve("locales"));
const origin = "http://127.0.0.1:4173";

async function openEmbed(
  page: Page,
  options: {
    csp?: boolean;
    storageDisabled?: boolean;
    theme?: string;
    lang?: string;
    hostCss?: string;
  } = {},
) {
  if (options.storageDisabled)
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Disabled", "SecurityError");
        },
      });
    });
  await page.route(`${origin}/embed-test`, (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: options.csp
        ? {
            "Content-Security-Policy":
              "default-src 'none'; script-src 'self' 'nonce-test-nonce'; style-src 'nonce-test-nonce'; connect-src 'self'; font-src 'self'; worker-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'",
          }
        : {},
      body: `<!doctype html><html lang="en"><head><title>Embed test</title><style nonce="test-nonce">${options.hostCss ?? ""}</style></head><body><main><h1>Host page</h1><button id="host-button">Host action</button></main><script id="dimts-script" async nonce="test-nonce" src="/dimts-embed.js" data-host-key="public-test-host" data-api="${origin}/v1" data-lang="${options.lang ?? "en"}" data-theme="${options.theme ?? "light"}" data-position="start" data-simple="true"></script></body></html>`,
    }),
  );
  await page.context().route(`${origin}/v1/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/languages"))
      return route.fulfill({
        json: {
          languages: ["en", "am", "om", "ar-test"].map((code) => ({
            code,
            nameNative: packs.get(code)!.meta.name_native,
            nameEn: packs.get(code)!.meta.name_en,
            script: packs.get(code)!.meta.script,
            dir: packs.get(code)!.meta.dir,
            status: "beta",
            stt: false,
            tts: false,
          })),
        },
      });
    if (pathname.endsWith("/ui"))
      return route.fulfill({
        json: packs.get(pathname.split("/").at(-2)!)!.ui,
      });
    if (pathname.endsWith("/faq"))
      return route.fulfill({
        json: {
          lang: pathname.split("/").at(-2),
          dir: "ltr",
          contentVersion: "fixture-v1",
          reviewedOn: null,
          items: [],
        },
      });
    if (pathname.endsWith("/sessions"))
      return route.fulfill({
        status: 201,
        json: {
          sessionId: "session-12345678",
          sessionToken: "session-token",
          resumeToken: "resume-token-12345678901234567890",
          lang: route.request().postDataJSON().lang,
        },
      });
    return route.fulfill({ json: {} });
  });
  await page.goto(`${origin}/embed-test`);
}

test("FR-INT-01/02/03 Level 1 installs from one async script, keeps host styling isolated and exposes only four methods", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.set(
      window,
      "__embedWindowBaseline",
      Object.getOwnPropertyNames(window),
    );
    Reflect.set(window, "__embedEvents", []);
    for (const type of [
      "dimts:opened",
      "dimts:closed",
      "dimts:language",
      "dimts:escalated",
    ])
      document.addEventListener(type, (event) => {
        (Reflect.get(window, "__embedEvents") as unknown[]).push({
          type: event.type,
          detail: (event as CustomEvent).detail,
          target: (event.target as HTMLElement).tagName,
        });
      });
  });
  await openEmbed(page);
  const host = page.locator("dimts-embed");
  await expect(host.locator("#dimts-launcher")).toBeVisible();
  expect(
    await page.evaluate(() => Object.keys(window.Dimts ?? {}).sort()),
  ).toEqual(["close", "escalate", "open", "setLanguage"]);
  await host.locator("#dimts-launcher").click();
  await expect(page.locator("#message")).toBeVisible();
  await expect(page.locator("dimts-assistant")).toHaveAttribute(
    "data-simple",
    "true",
  );
  await page.evaluate(() => window.Dimts?.close());
  await expect(page.locator("dimts-assistant")).toBeHidden();
  await page.evaluate(() => window.Dimts?.open());
  await expect(page.locator("#message")).toBeVisible();
  await page.evaluate(() => window.Dimts?.setLanguage("om"));
  await expect(page.locator("dimts-assistant")).toHaveAttribute("lang", "om");
  // The element's language changes before the asynchronous UI pack arrives.
  // Wait for the localized launcher/event boundary, not the intermediate attribute.
  await expect(host).toHaveAttribute("lang", "om");
  await page.evaluate(() => window.Dimts?.escalate());
  const events = await page.evaluate(
    () =>
      Reflect.get(window, "__embedEvents") as {
        type: string;
        detail: unknown;
        target: string;
      }[],
  );
  expect(events.filter((event) => event.type === "dimts:opened")).toHaveLength(
    2,
  );
  expect(events.filter((event) => event.type === "dimts:closed")).toHaveLength(
    1,
  );
  expect(
    events.find(
      (event) =>
        event.type === "dimts:language" &&
        (event.detail as { lang: string }).lang === "om",
    ),
  ).toBeTruthy();
  expect(
    events.find((event) => event.type === "dimts:escalated")?.detail,
  ).toEqual({ lang: "om" });
  expect(
    await page.evaluate(() =>
      Object.getOwnPropertyNames(window).filter(
        (key) =>
          !(Reflect.get(window, "__embedWindowBaseline") as string[]).includes(
            key,
          ) &&
          ![
            "__embedWindowBaseline",
            "__embedEvents",
            "host-button",
            "dimts-script",
            "Dimts",
          ].includes(key),
      ),
    ),
  ).toEqual([]);
  expect(
    await page.locator("#host-button").evaluate((el) => el.shadowRoot),
  ).toBeNull();
  expect(errors).toEqual([]);
});

test("FR-UI-19 accessible host custom properties apply to an initially dark embed", async ({
  page,
}) => {
  await openEmbed(page, {
    theme: "dark",
    hostCss:
      "dimts-embed{--dimts-surface:#ffffff;--dimts-text:#000000;--dimts-muted:#000000;--dimts-primary:#000000;--dimts-primary-text:#ffffff;--dimts-border:#000000;--dimts-focus:#000000;--dimts-font-family:serif;--dimts-radius:1rem}",
  });
  await page.locator("#dimts-launcher").click();
  await expect(page.locator("#message")).toBeEnabled();
  const values = await page.locator("dimts-assistant").evaluate((el) => {
    const style = getComputedStyle(el);
    return [
      "--dimts-surface",
      "--dimts-text",
      "--dimts-radius",
      "--dimts-font-family",
    ].map((property) => style.getPropertyValue(property).trim());
  });
  expect(values).toEqual(["#ffffff", "#000000", "1rem", "serif"]);
});

for (const lang of ["en", "am", "om", "ar-test"])
  for (const theme of ["light", "dark", "contrast"]) {
    test(`NFR-A11Y-02 embed launcher/chat ${lang}/${theme} at 320 px and enlarged text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      await openEmbed(page, { lang, theme });
      const { AxeBuilder } = await import("@axe-core/playwright");
      await expect(page.locator("#dimts-launcher")).toBeVisible();
      let results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.filter((item) =>
          ["serious", "critical"].includes(item.impact ?? ""),
        ),
      ).toEqual([]);
      await page.locator("#dimts-launcher").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#message")).toBeEnabled();
      await expect(page.locator("dimts-embed")).toHaveAttribute(
        "dir",
        packs.get(lang)!.meta.dir,
      );
      const ui = packs.get(lang)!.ui;
      if (lang === "en" && theme === "light") {
        // CSS render-scale coverage is distinct from native browser zoom,
        // which still needs the documented manual/device check.
        await page.setViewportSize({ width: 640, height: 1000 });
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
        });
        await expect
          .poll(() =>
            page
              .locator("#dimts-panel")
              .evaluate((el) => el.getBoundingClientRect().width),
          )
          .toBeLessThanOrEqual(640);
      } else {
        await page
          .getByRole("button", { name: ui["settings.button"], exact: true })
          .click();
        await page
          .getByRole("button", { name: ui["settings.scale200"], exact: true })
          .click();
        await page
          .getByRole("button", { name: ui["settings.button"], exact: true })
          .click();
      }
      const layout = await page
        .locator("#dimts-panel")
        .evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      expect(layout.scroll).toBeLessThanOrEqual(layout.client);
      results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.filter((item) =>
          ["serious", "critical"].includes(item.impact ?? ""),
        ),
      ).toEqual([]);
      expect(requests.every((url) => new URL(url).origin === origin)).toBe(
        true,
      );
    });
  }

test("FR-INT-04 strict CSP works with a nonce and storage disabled", async ({
  page,
}) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    const metadata = new WeakMap();
    Reflect.set(window, "litPropertyMetadata", metadata);
    Reflect.set(window, "__hostLitMetadata", metadata);
  });
  await page.exposeFunction("recordCspViolation", (directive: string) =>
    violations.push(directive),
  );
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) => {
      void (
        window as unknown as {
          recordCspViolation(directive: string): Promise<void>;
        }
      ).recordCspViolation(event.violatedDirective);
    }),
  );
  await openEmbed(page, { csp: true, storageDisabled: true });
  await page.locator("#dimts-launcher").click();
  await expect(page.locator("#message")).toBeEnabled();
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(() => {
      const metadata = Reflect.get(window, "litPropertyMetadata") as WeakMap<
        object,
        Map<string, { type: StringConstructor }>
      >;
      if (metadata !== Reflect.get(window, "__hostLitMetadata")) return false;
      const Base = customElements.get("dimts-assistant")!;
      class HostDecoratedAssistant extends Base {}
      const key = {};
      metadata.set(key, new Map([["hostProperty", { type: String }]]));
      Reflect.set(HostDecoratedAssistant, Reflect.get(Symbol, "metadata"), key);
      customElements.define(
        "dimts-host-metadata-check",
        HostDecoratedAssistant,
      );
      const instance = document.createElement("dimts-host-metadata-check");
      instance.setAttribute("hostproperty", "compatible");
      return Reflect.get(instance, "hostProperty") === "compatible";
    }),
  ).toBe(true);
});

test("FR-INT-11 removing the script uninstalls owned UI, timers, listeners and storage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const trackedTypes = new Set(["online", "offline", "keydown", "resize"]);
    const listeners = new Map<
      string,
      Set<EventListenerOrEventListenerObject>
    >();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = (type, listener, options) => {
      if (listener && trackedTypes.has(type)) {
        const values = listeners.get(type) ?? new Set();
        values.add(listener);
        listeners.set(type, values);
      }
      add(type, listener, options);
    };
    window.removeEventListener = (type, listener, options) => {
      if (listener) listeners.get(type)?.delete(listener);
      remove(type, listener, options);
    };
    Reflect.set(window, "__ownedListenerCount", () =>
      [...listeners.values()].reduce((sum, values) => sum + values.size, 0),
    );
    const timers = new Set<number>();
    const set = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    window.setTimeout = (
      callback: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      const id = set(() => {
        timers.delete(id);
        if (typeof callback === "function") callback(...args);
      }, delay);
      timers.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      if (id !== undefined) timers.delete(id);
      clear(id);
    };
    Reflect.set(window, "__ownedTimerCount", () => timers.size);
  });
  await openEmbed(page);
  await page.locator("#dimts-launcher").click();
  await expect(page.locator("#message")).toBeVisible();
  await page.evaluate(() => window.Dimts?.setLanguage("am"));
  await expect(page.locator("dimts-assistant")).toHaveAttribute("lang", "am");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (Reflect.get(window, "__ownedListenerCount") as () => number)(),
      ),
    )
    .toBe(4);
  await page.evaluate(() => {
    localStorage.setItem("host.setting", "keep");
    localStorage.setItem("dimts.settings", "{}");
    document.querySelector("#dimts-script")?.remove();
  });
  await expect(page.locator("dimts-embed")).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      api: typeof window.Dimts,
      host: localStorage.getItem("host.setting"),
      settings: localStorage.getItem("dimts.settings"),
    })),
  ).toEqual({ api: "undefined", host: "keep", settings: null });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (Reflect.get(window, "__ownedListenerCount") as () => number)(),
      ),
    )
    .toBe(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (Reflect.get(window, "__ownedTimerCount") as () => number)(),
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(
      () =>
        [...document.fonts].filter(
          (font) => font.family === "Noto Sans Ethiopic",
        ).length,
    ),
  ).toBe(0);
  // Reinstall after the original bundle is already evaluated and its globals
  // are gone. A fresh subclass forces Lit's property-finalization path again.
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.id = "dimts-script";
    script.src = "/dimts-embed.js";
    script.async = true;
    script.dataset.api = "/v1";
    script.dataset.hostKey = "public-test-host";
    script.dataset.lang = "en";
    document.body.append(script);
  });
  await page.locator("#dimts-launcher").click();
  await expect(page.locator("#message")).toBeEnabled();
  expect(
    await page.evaluate(() => {
      const Base = customElements.get("dimts-assistant")!;
      class ReinstalledAssistant extends Base {
        static properties = { checkValue: { type: String } };
      }
      customElements.define("dimts-reinstall-check", ReinstalledAssistant);
      const instance = document.createElement("dimts-reinstall-check");
      instance.setAttribute("checkvalue", "preserved");
      return Reflect.get(instance, "checkValue");
    }),
  ).toBe("preserved");
  expect(
    await page.evaluate(() => Object.hasOwn(window, "litPropertyMetadata")),
  ).toBe(false);
});

test("FR-UI-19 rejects low-contrast host colors and permits accessible themes", async ({
  page,
}) => {
  await openEmbed(page, { theme: "dark" });
  await page.locator("#dimts-launcher").click();
  const widget = page.locator("dimts-assistant");
  await expect(widget).toHaveAttribute("data-theme", "dark");
  await widget.evaluate((el) => {
    el.style.setProperty("--dimts-text", "#eeeeee");
    el.style.setProperty("--dimts-surface", "#ffffff");
  });
  await expect
    .poll(() =>
      widget.evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--dimts-surface").trim(),
      ),
    )
    .toBe("#0f1b2d");
});
