import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { getVisiblePacks, loadPacks } from "../../locales-tools/src/index.js";

const packs = loadPacks(resolve("locales"));

test("P03 consent persists opt-in and revocation before the next question", async ({
  page,
}) => {
  const sessions: Record<string, unknown>[] = [];
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/sessions")) {
      sessions.push(request.postDataJSON());
      calls.push("session");
    }
    if (request.url().endsWith("/ask")) calls.push("ask");
  });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  const consent = page.getByRole("checkbox", {
    name: "Allow remote AI for this session",
  });
  await expect(consent).not.toBeChecked();
  await consent.check();
  await expect.poll(() => sessions.at(-1)?.cloudOk).toBe(true);
  expect(sessions.at(-1)).toMatchObject({
    sessionId: "session-12345678",
    resumeToken: "resume-token-12345678901234567890",
    consentVersion: "remote-ai-v1",
  });
  await consent.uncheck();
  await page.locator("#message").fill("Help me study");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator('[data-role="assistant"]')).toBeVisible();
  expect(sessions.at(-1)?.cloudOk).toBe(false);
  expect(calls.at(-2)).toBe("session");
  expect(calls.at(-1)).toBe("ask");
});

test("P03 failed revocation blocks another ask and provides a retry", async ({
  page,
}) => {
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  const consent = page.getByRole("checkbox", {
    name: "Allow remote AI for this session",
  });
  await consent.check();
  await expect(
    page.getByText("Your choice is saved for this session."),
  ).toBeVisible();
  await page.route("http://api.test/v1/sessions", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await consent.uncheck();
  await expect(
    page.getByText("Your choice could not be saved. Try again before sending."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator(".consent").getByRole("button", { name: "Try again" }),
  ).toBeEnabled();
});

for (const scenario of [
  "opt-in",
  "revocation",
  "fresh-session-retry",
] as const) {
  test(`P03 lost consent response recovers ${scenario} with a fresh local-only session`, async ({
    page,
  }) => {
    const helpAuth: Record<string, unknown>[] = [];
    await page.routeWebSocket("ws://api.test/v1/help/ws", (socket) => {
      socket.onMessage((raw) => {
        const frame = JSON.parse(String(raw)) as Record<string, unknown>;
        if (frame.type === "auth") {
          helpAuth.push(frame);
          socket.send(JSON.stringify({ type: "help.joined" }));
        }
      });
    });
    await openWidget(page);
    await page.getByRole("button", { name: "English" }).click();
    const consent = page.getByRole("checkbox", {
      name: "Allow remote AI for this session",
    });
    if (scenario !== "opt-in") {
      await consent.check();
      await expect(
        page.getByText("Your choice is saved for this session."),
      ).toBeVisible();
    }
    await page.locator("#message").fill("Previous question");
    const previousAsk = page.waitForRequest("http://api.test/v1/ask");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const oldClientMessageId = (await previousAsk).postDataJSON()
      .clientMsgId as string;
    await page
      .locator('[data-role="assistant"]')
      .getByRole("button", { name: "Helpful", exact: true })
      .click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("checkbox", { name: "High contrast" }).check();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Help me now" }).click();
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await expect.poll(() => helpAuth.length).toBe(1);
    await page.locator("#message").fill("Keep this unfinished question.");
    const sessionBodies: Record<string, unknown>[] = [];
    let resumeAttempts = 0;
    let freshAttempts = 0;
    await page.route("http://api.test/v1/sessions", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      sessionBodies.push(body);
      if (body.sessionId) {
        resumeAttempts += 1;
        if (resumeAttempts === 1) return route.abort("failed");
        return route.fulfill({ status: 401, json: {} });
      }
      freshAttempts += 1;
      if (scenario === "fresh-session-retry" && freshAttempts === 1)
        return route.fulfill({ status: 503, json: {} });
      return route.fulfill({
        status: 201,
        json: {
          sessionId: "fresh-session-12345678",
          sessionToken: "fresh-session-token",
          resumeToken: "fresh-resume-token-1234567890",
          lang: "en",
          cloudOk: false,
          consentVersion: null,
        },
      });
    });
    if (scenario === "opt-in") await consent.check();
    else await consent.uncheck();
    await expect(
      page.getByText(
        "Your choice could not be saved. Try again before sending.",
      ),
    ).toBeVisible();
    await page
      .locator(".consent")
      .getByRole("button", { name: "Try again" })
      .click();
    if (scenario === "fresh-session-retry") {
      await expect(
        page.getByText(packs.get("en")!.ui["error.network"]!, { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
    }
    await expect(
      page.getByText(
        "Your previous chat ended. A new chat is ready with remote AI off.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(consent).not.toBeChecked();
    await expect(page.locator("dimts-assistant")).toHaveAttribute(
      "high-contrast",
      "",
    );
    await expect(page.locator("#message")).toHaveValue(
      "Keep this unfinished question.",
    );
    await expect(
      page.locator(
        '[data-role="assistant"], [data-role="learner"], .help-chat',
      ),
    ).toHaveCount(0);
    expect(resumeAttempts).toBe(2);
    expect(freshAttempts).toBe(scenario === "fresh-session-retry" ? 2 : 1);
    expect(sessionBodies.filter((body) => !body.sessionId)).toEqual(
      Array.from({ length: freshAttempts }, () => ({
        lang: "en",
        channel: "web",
      })),
    );
    const request = page.waitForRequest("http://api.test/v1/ask");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const nextAsk = await request;
    expect(nextAsk.headers().authorization).toBe("Bearer fresh-session-token");
    expect(nextAsk.postDataJSON()).toEqual({
      sessionId: "fresh-session-12345678",
      clientMsgId: expect.any(String),
      lang: "en",
      text: "Keep this unfinished question.",
      via: "text",
      simple: false,
    });
    expect(nextAsk.postDataJSON().clientMsgId).not.toBe(oldClientMessageId);
    await page.clock.install();
    await page.clock.fastForward(35_000);
    expect(helpAuth).toHaveLength(1);
  });
}

test("P03 reply actions copy and submit only the reply id and helpful flag", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await page.locator("#message").fill("Help me study");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const reply = page.locator('[data-role="assistant"]');
  await expect(reply).toBeFocused();
  await reply.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Choose one topic to learn this week.");
  const feedback = page.waitForRequest("http://api.test/v1/feedback");
  await reply.getByRole("button", { name: "Not helpful", exact: true }).click();
  const request = await feedback;
  expect(request.postDataJSON()).toEqual({
    replyId: "reply-1",
    helpful: false,
  });
  expect(request.headers().authorization).toBe("Bearer session-token");
  await expect(
    reply.getByRole("button", { name: "Not helpful", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("P03 shortcuts are documented, work with modifiers, and can be disabled", async ({
  page,
}) => {
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();
  await expect(page.locator("#message")).toBeEnabled();
  await page.keyboard.press("Alt+Shift+L");
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();
  await page.keyboard.press("Alt+Shift+H");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: packs.get("en")!.ui["help.includeSummary"],
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByText(
      "Alt+Shift+M: microphone; Alt+Shift+H: help; Alt+Shift+L: language; Alt+Shift+S: stop sharing.",
    ),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Keyboard shortcuts" }).uncheck();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.keyboard.press("Alt+Shift+H");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#message").fill("hml");
  await expect(page.locator("#message")).toHaveValue("hml");
});

test("P03 Simple mode makes text large, hides advanced controls, and keeps one citation", async ({
  page,
}) => {
  await openWidget(page);
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("checkbox", { name: "Simple mode" }).check();
  await expect(page.getByRole("checkbox", { name: "Data saver" })).toHaveCount(
    0,
  );
  await expect(page.locator("#speech-rate")).toHaveCount(0);
  const scale = await page
    .locator("dimts-assistant")
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
  expect(scale).toBeGreaterThanOrEqual(24);
  await page.getByRole("button", { name: "English" }).click();
  await page.route("http://api.test/v1/ask", (route) =>
    route.fulfill({
      json: {
        id: "simple-1",
        kind: "answer",
        text: "Choose one topic.",
        lang: "en",
        dir: "ltr",
        citations: [
          { label: "Best", url: "https://course.test/best" },
          { label: "Other", url: "https://course.test/other" },
        ],
      },
    }),
  );
  await page.locator("#message").fill("Study");
  const ask = page.waitForRequest("http://api.test/v1/ask");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await ask).postDataJSON().simple).toBe(true);
  await expect(
    page.locator('[data-role="assistant"] .citations a'),
  ).toHaveCount(1);
  await expect(page.locator(".primary")).toHaveCount(1);
  await expect(page.locator(".primary [aria-hidden=true]")).toHaveCount(1);
});

test("P03 slow startup and reply announce once with usable help and retry", async ({
  page,
}) => {
  await openWidget(page);
  let finishSession: (() => void) | undefined;
  await page.route("http://api.test/v1/sessions", async (route) => {
    await new Promise<void>((resolve) => {
      finishSession = resolve;
    });
    await route.fulfill({ status: 503, json: {} });
  });
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page
      .locator('[role="status"]')
      .filter({ hasText: packs.get("en")!.ui["waking.message"]! }),
  ).toHaveAttribute("aria-live", "polite", { timeout: 5000 });
  await expect(page.getByRole("button", { name: "Help me now" })).toBeEnabled();
  finishSession?.();
  await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
});

test("P03 a slow question announces politely once and provides retry and help", async ({
  page,
}) => {
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("#message")).toBeVisible();
  let finish: (() => void) | undefined;
  const clientMessageIds: string[] = [];
  await page.route("http://api.test/v1/ask", async (route) => {
    clientMessageIds.push(route.request().postDataJSON().clientMsgId as string);
    if (clientMessageIds.length === 1) {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      // The browser cancels this request while the server may still be working.
      await route.fulfill({ status: 503, json: {} }).catch(() => undefined);
    } else if (clientMessageIds.length === 2) {
      await route.fulfill({ status: 409, json: {} });
    } else {
      await route.fulfill({
        json: {
          id: "slow-reply",
          kind: "answer",
          text: "Choose one topic.",
          lang: "en",
          dir: "ltr",
          citations: [],
        },
      });
    }
  });
  await page.evaluate(() => {
    const status = document
      .querySelector("dimts-assistant")!
      .shadowRoot!.querySelector(".chat > .status")!;
    (
      window as Window & { __workingAnnouncements?: number }
    ).__workingAnnouncements = 0;
    new MutationObserver(() => {
      if (status.textContent?.includes("Working on it"))
        (
          window as Window & { __workingAnnouncements: number }
        ).__workingAnnouncements += 1;
    }).observe(status, { childList: true, subtree: true, characterData: true });
  });
  await page.locator("#message").fill("A slow question");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const status = page.locator(".chat > .status");
  await expect(status).toContainText("Working on it", { timeout: 5000 });
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status.getByRole("button", { name: "Try again" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Help me now" })).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __workingAnnouncements: number })
          .__workingAnnouncements,
    ),
  ).toBe(1);
  await status.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => clientMessageIds.length).toBe(2);
  finish?.();
  await expect(page.locator("#message")).toHaveValue("A slow question");
  await status.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator('[data-role="assistant"]')).toBeFocused();
  expect(clientMessageIds).toEqual([
    clientMessageIds[0],
    clientMessageIds[0],
    clientMessageIds[0],
  ]);
  await expect(page.locator('[data-role="learner"]')).toHaveCount(1);
});

test("P03 Simple replies read aloud and the microphone shortcut preserves review", async ({
  page,
}) => {
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    const target = window as TestWindow;
    target.__spoken = [];
    target.__voice = { starts: [], stops: 0 };
    widget.textToSpeech = {
      supported: () => true,
      speak: async (text, lang, rate) => {
        target.__spoken?.push({ text, lang, rate });
      },
      pause() {},
      resume() {},
      stop() {},
    };
    widget.speechToText = {
      supported: () => true,
      start: (lang) =>
        new Promise<string>((resolve) => {
          target.__voice!.starts.push(lang);
          target.__voice!.resolve = resolve;
        }),
      stop: () => {
        target.__voice!.stops += 1;
        target.__voice!.resolve?.("Review these words");
      },
    };
    await widget.updateComplete;
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Simple mode" }).check();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.keyboard.press("Alt+Shift+M");
  await expect(
    page.getByRole("button", { name: "Stop talking", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Alt+Shift+M");
  await expect(page.locator("#message")).toHaveValue("Review these words");
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as TestWindow).__spoken?.at(-1)?.text),
    )
    .toBe("Choose one topic to learn this week.");
});

test("FR-LANG-15 proposes editable text only after opt-in and requires confirmation before sending", async ({
  page,
}) => {
  await openWidget(page, { languages: languageChoices });
  await page.getByRole("button", { name: "አማርኛ" }).click();
  const ui = packs.get("am")!.ui;
  const question = page.locator("#message");
  const suggestion = page.locator("#transliteration-suggestion");
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/ask"))
      sent.push(request.postDataJSON().text as string);
  });
  await question.fill("selam");
  await expect(suggestion).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: ui["transliteration.enable"] })
    .check();
  await expect(suggestion).toHaveValue("ሰላም");
  await expect(question).toHaveValue("selam");
  expect(sent).toEqual([]);
  await suggestion.fill("ሰላም ለእርስዎ");
  await suggestion.press("Enter");
  expect(sent).toEqual([]);
  await suggestion.fill("ሰላም ለእርስዎ");
  await page.getByRole("button", { name: ui["transliteration.use"] }).click();
  await expect(question).toHaveValue("ሰላም ለእርስዎ");
  await expect(question).toBeFocused();
  expect(sent).toEqual([]);
  await page
    .getByRole("button", { name: ui["review.send"], exact: true })
    .click();
  await expect.poll(() => sent).toEqual(["ሰላም ለእርስዎ"]);
});

test("FR-LANG-15 keeps direct Ethiopic input and removes suggestions when disabled", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openWidget(page, { languages: languageChoices });
  await page.getByRole("button", { name: "አማርኛ" }).click();
  const ui = packs.get("am")!.ui;
  const question = page.locator("#message");
  const enabled = page.getByRole("checkbox", {
    name: ui["transliteration.enable"],
  });
  await page.getByRole("button", { name: ui["settings.button"]! }).click();
  await page.getByRole("button", { name: ui["settings.scale200"]! }).click();
  await page.getByRole("button", { name: ui["settings.button"]! }).click();
  await enabled.check();
  await question.fill("ሰላም");
  await expect(question).toHaveValue("ሰላም");
  await expect(page.locator("#transliteration-suggestion")).toHaveCount(0);
  await question.fill("selam");
  await expect(page.locator("#transliteration-suggestion")).toHaveValue("ሰላም");
  const layout = await page.locator("dimts-assistant").evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  const { AxeBuilder } = await import("@axe-core/playwright");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  await enabled.uncheck();
  await expect(page.locator("#transliteration-suggestion")).toHaveCount(0);
  await expect(question).toHaveValue("selam");
});

test("FR-LANG-07 offers an explicit Afaan Oromoo choice for Latin input", async ({
  page,
}) => {
  await openWidget(page, { languages: languageChoices });
  await page.getByRole("button", { name: "English" }).click();

  const question = "Torban kana mata duree meeqa filachuu qaba?";
  const composer = page.locator("#message");
  await composer.fill(question);

  const prompt = packs.get("en")!.ui["language.suggestion.latin"]!;
  const suggestions = page.getByRole("region", { name: prompt });
  await expect(suggestions).toBeVisible();
  await expect(
    suggestions.getByRole("button", { name: "Afaan Oromoo" }),
  ).toHaveAttribute("aria-pressed", "false");

  const askRequest = page.waitForRequest("http://api.test/v1/ask");
  await suggestions.getByRole("button", { name: "Afaan Oromoo" }).click();
  await expect(
    suggestions.getByRole("button", { name: "Afaan Oromoo" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", {
      name: packs.get("om")!.ui["review.send"],
      exact: true,
    })
    .click();
  expect((await askRequest).postDataJSON()).toMatchObject({
    lang: "om",
    text: question,
  });
});

test("FR-LANG-05 announces resolved string fallback once in a learner session", async ({
  page,
}) => {
  await openWidget(page, {
    languages: languageChoices,
    fallbackLanguages: ["am", "om"],
  });
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("button", { name: "አማርኛ" }).click();
  await expect(page.locator("#language-fallback-notice")).toHaveText(
    packs.get("am")!.ui["notice.languageFallback"]!,
  );
  await page
    .getByRole("button", { name: packs.get("am")!.ui["language.button"]! })
    .click();
  await page.getByRole("button", { name: "Afaan Oromoo" }).click();
  await expect(page.locator("#language-fallback-notice")).toHaveText("");
  await expect(page.locator("#message")).toBeEnabled();
});

test("FR-LANG-05 preserves the fallback notice when the first session starts", async ({
  page,
}) => {
  await openWidget(page, { fallbackLanguages: ["en"] });
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("#message")).toBeVisible();
  await expect(page.locator("#language-fallback-notice")).toHaveText(
    packs.get("en")!.ui["notice.languageFallback"]!,
  );
});

test("FR-LANG-10 hides drafts by default and labels beta but not live choices", async ({
  page,
}) => {
  await openWidget(page, {
    languages: languageChoices.map((language) => ({
      ...language,
      status:
        language.code === "en"
          ? "live"
          : language.code === "am"
            ? "beta"
            : "draft",
    })),
  });
  await expect(page.getByRole("button", { name: "Afaan Oromoo" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "አማርኛ" })).toContainText(
    packs.get("en")!.ui["status.beta"]!,
  );
  await expect(page.getByRole("button", { name: "English" })).not.toContainText(
    packs.get("en")!.ui["status.beta"]!,
  );
});

test("FR-LANG-10 explicit language preview lists draft cards and forwards the API preview query", async ({
  page,
}) => {
  const requests: URL[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://api.test/v1/"))
      requests.push(new URL(request.url()));
  });
  await openWidget(page, {
    preview: true,
    languages: languageChoices.map((language) => ({
      ...language,
      status: language.code === "en" ? "beta" : "draft",
    })),
  });
  await expect(
    page.getByRole("button", { name: "Afaan Oromoo" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "አማርኛ" }).click();
  await expect(
    page.getByText(packs.get("am")!.ui["error.network"]!, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#message")).toHaveCount(0);
  expect(
    requests
      .filter(
        (url) =>
          url.pathname.endsWith("/languages") || url.pathname.endsWith("/ui"),
      )
      .every((url) => url.searchParams.get("lang_preview") === "1"),
  ).toBe(true);
  expect(requests.some((url) => url.pathname.endsWith("/locales/am/ui"))).toBe(
    true,
  );
  expect(
    requests.find((url) => url.pathname.endsWith("/sessions"))?.search,
  ).toBe("");
});
interface TestLanguage {
  code: string;
  nameNative: string;
  nameEn: string;
  script: string;
  dir: "ltr" | "rtl";
  status: "live" | "beta" | "draft";
  stt: boolean;
  tts: boolean;
}

const languages: TestLanguage[] = getVisiblePacks(packs).map((pack) => ({
  code: pack.meta.code,
  nameNative: pack.meta.name_native,
  nameEn: pack.meta.name_en,
  script: pack.meta.script,
  dir: pack.meta.dir,
  status: pack.meta.status,
  stt: pack.meta.stt,
  tts: pack.meta.tts,
}));
const languageChoices: TestLanguage[] = [
  ...languages,
  {
    code: "am",
    nameNative: "አማርኛ",
    nameEn: "Amharic",
    script: "Ethi",
    dir: "ltr",
    status: "beta",
    stt: false,
    tts: false,
  },
  {
    code: "om",
    nameNative: "Afaan Oromoo",
    nameEn: "Afaan Oromoo",
    script: "Latn",
    dir: "ltr",
    status: "beta",
    stt: false,
    tts: false,
  },
];
const voiceEnabledTestLanguages = languages.map((language) =>
  language.code === "en" ? { ...language, stt: true, tts: true } : language,
);

interface TestSpeechToText {
  supported(lang: string): boolean;
  start(lang: string): Promise<string>;
  stop(): void;
}

interface TestTextToSpeech {
  supported(lang: string): boolean;
  speak(text: string, lang: string, rate: number): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

type WidgetElement = HTMLElement & {
  speechToText?: TestSpeechToText;
  textToSpeech?: TestTextToSpeech;
  updateComplete?: Promise<unknown>;
};

type TestWindow = Window & {
  __voice?: {
    starts: string[];
    stops: number;
    resolve?: (text: string) => void;
  };
  __toneFrequencies?: number[];
  __vibrationPatterns?: (number | number[])[];
  __spoken?: { text: string; lang: string; rate: number }[];
  __speechControls?: {
    pauses: number;
    resumes: number;
    stops: number;
    finish?: () => void;
  };
};

function colorChannels(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{6})$/iu);
  if (hex?.[1]) {
    const value = Number.parseInt(hex[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/u);
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  throw new Error(`Unsupported color: ${color}`);
}

function luminance(color: string): number {
  const channels = colorChannels(color).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

async function openWidget(
  page: import("@playwright/test").Page,
  options: {
    failFirstAsk?: boolean;
    languages?: TestLanguage[];
    fallbackLanguages?: string[];
    preview?: boolean;
  } = {},
) {
  let failNextAsk = options.failFirstAsk ?? false;
  let networkOffline = false;
  const helpRequests: { sessionId: string; includeSummary: boolean }[] = [];
  const helpClosures: { requestId: string; sessionId: string }[] = [];
  await page.route(
    /^http:\/\/127\.0\.0\.1:4173\/(?:\?lang_preview=1)?$/u,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><title>Widget test</title></head><body><dimts-assistant data-api="http://api.test/v1" data-host-key="test-host"></dimts-assistant><script type="module" src="/dimts-widget.js"></script></body></html>',
      }),
  );
  await page.context().route("http://api.test/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      networkOffline &&
      ["languages", "ui"].some((part) => url.pathname.endsWith(part))
    ) {
      await route.abort("internetdisconnected");
      return;
    }
    if (url.pathname.endsWith("/languages")) {
      await route.fulfill({
        json: { languages: options.languages ?? languages },
      });
      return;
    }
    if (/\/locales\/[^/]+\/ui$/u.test(url.pathname)) {
      const code = url.pathname.split("/").at(-2) ?? "en";
      await route.fulfill({
        json: packs.get(code)?.ui ?? {},
        headers: {
          "X-Dimts-Locale-Fallback": options.fallbackLanguages?.includes(code)
            ? "1"
            : "0",
          "Access-Control-Expose-Headers": "X-Dimts-Locale-Fallback",
        },
      });
      return;
    }
    if (url.pathname.endsWith("/sessions")) {
      const sessionBody = route.request().postDataJSON();
      const requestLanguage = sessionBody.lang as string;
      if (
        options.languages?.some(
          (language) =>
            language.code === requestLanguage && language.status === "draft",
        )
      ) {
        await route.fulfill({ status: 400, json: {} });
        return;
      }
      await route.fulfill({
        status: 201,
        json: {
          sessionId: "session-12345678",
          sessionToken: "session-token",
          resumeToken: "resume-token-12345678901234567890",
          lang: "en",
          cloudOk: sessionBody.cloudOk === true,
          consentVersion: sessionBody.cloudOk ? "remote-ai-v1" : null,
        },
      });
      return;
    }
    if (url.pathname.endsWith("/feedback")) {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (url.pathname.endsWith("/help") && route.request().method() === "POST") {
      helpRequests.push(
        JSON.parse(route.request().postData() ?? "{}") as {
          sessionId: string;
          includeSummary: boolean;
        },
      );
      await route.fulfill({
        status: 201,
        json: { id: "help-request-1", status: "waiting" },
      });
      return;
    }
    if (
      url.pathname.endsWith("/help/help-request-1/close") &&
      route.request().method() === "POST"
    ) {
      helpClosures.push(
        JSON.parse(route.request().postData() ?? "{}") as {
          sessionId: string;
        },
      );
      await route.fulfill({ status: 204 });
      return;
    }
    if (url.pathname.endsWith("/ask")) {
      if (failNextAsk) {
        failNextAsk = false;
        await route.fulfill({ status: 503, json: {} });
        return;
      }
      await route.fulfill({
        json: {
          id: "reply-1",
          kind: "answer",
          text: "Choose one topic to learn this week.",
          lang: "en",
          dir: "ltr",
          citations: [
            {
              passageId: "study-plan#goals",
              label: "Study plan / Choose one goal",
              url: "https://course.test/study-plan#choose-one-goal",
              sourceLang: "en",
              sourceType: "course",
            },
          ],
          actions: [],
          contentVersion: "v1",
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: {} });
  });
  await page.goto(
    `http://127.0.0.1:4173/${options.preview ? "?lang_preview=1" : ""}`,
  );
  return {
    disconnectApi: () => {
      networkOffline = true;
    },
    helpRequests,
    helpClosures,
  };
}

async function installCueMocks(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = window as TestWindow;
    testWindow.__toneFrequencies = [];
    testWindow.__vibrationPatterns = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        testWindow.__vibrationPatterns?.push(pattern);
        return true;
      },
    });

    class MockAudioContext {
      currentTime = 0;
      destination = {};
      state = "running";

      createOscillator() {
        const testWindow = window as TestWindow;
        const frequency = {
          value: 0,
          setValueAtTime(value: number) {
            this.value = value;
          },
        };
        return {
          frequency,
          connect() {},
          start() {
            testWindow.__toneFrequencies?.push(frequency.value);
          },
          stop() {},
        };
      }

      createGain() {
        return {
          gain: { value: 0, setValueAtTime() {} },
          connect() {},
        };
      }

      close() {
        this.state = "closed";
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: MockAudioContext,
    });
  });
}

async function attachPendingSpeech(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    const testWindow = window as TestWindow;
    testWindow.__voice = { starts: [], stops: 0 };
    widget.speechToText = {
      supported: (lang) => lang === "en",
      start: (lang) =>
        new Promise((resolve) => {
          testWindow.__voice?.starts.push(lang);
          if (testWindow.__voice) testWindow.__voice.resolve = resolve;
        }),
      stop: () => {
        if (testWindow.__voice) {
          testWindow.__voice.stops += 1;
          testWindow.__voice.resolve?.("How do I plan my study?");
        }
      },
    };
    await widget.updateComplete;
  });
}

test("loads the language picker with a same-origin relative API root", async ({
  page,
}) => {
  const socketFrames: Record<string, unknown>[] = [];
  await page.route("http://127.0.0.1:4173/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>Widget test</title></head><body><dimts-assistant data-api="/v1" data-host-key="test-host"></dimts-assistant><script type="module" src="/dimts-widget.js"></script></body></html>',
    }),
  );
  await page.route("http://127.0.0.1:4173/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/languages")) {
      await route.fulfill({ json: { languages } });
      return;
    }
    if (/\/locales\/[^/]+\/ui$/u.test(url.pathname)) {
      const code = url.pathname.split("/").at(-2) ?? "en";
      await route.fulfill({ json: packs.get(code)?.ui ?? {} });
      return;
    }
    if (url.pathname.endsWith("/sessions")) {
      await route.fulfill({
        status: 201,
        json: { sessionId: "session-12345678", sessionToken: "session-token" },
      });
      return;
    }
    if (url.pathname.endsWith("/help") && route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        json: { id: "help-request-1", status: "waiting" },
      });
      return;
    }
    if (
      url.pathname.endsWith("/help/help-request-1/close") &&
      route.request().method() === "POST"
    ) {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 404, json: {} });
  });
  await page.routeWebSocket("ws://127.0.0.1:4173/v1/help/ws", (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      socketFrames.push(frame);
      if (frame.type === "auth") {
        socket.send(JSON.stringify({ type: "help.joined" }));
      }
    });
  });
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Help me now" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Send request" })
    .click();
  await expect(page.getByText("Connected to a helper.")).toBeVisible();
  expect(socketFrames).toContainEqual(
    expect.objectContaining({
      type: "auth",
      requestId: "help-request-1",
      role: "learner",
      sessionId: "session-12345678",
    }),
  );
  await page.getByRole("button", { name: "End help" }).click();
  await expect(
    page.getByText(
      "This help chat has ended. You can continue with the tutor.",
    ),
  ).toBeVisible();
});

test("refreshes cached shell assets while online", async ({ page }) => {
  await openWidget(page);
  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);

  const shellCacheName = await page.evaluate(async () =>
    (await caches.keys()).find((name) => name.startsWith("dimts-shell-")),
  );
  if (!shellCacheName) throw new Error("Expected the widget shell cache.");
  await page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    await cache.put(
      new URL("/dimts-widget.js", location.origin),
      new Response("stale shell"),
    );
  }, shellCacheName);

  const bundle = await page.evaluate(async () =>
    (await fetch("/dimts-widget.js")).text(),
  );
  expect(bundle).not.toBe("stale shell");
  expect(bundle).toContain("DimtsAssistant");
});

test("keeps Help me now fixed in one corner and within the first five tab stops", async ({
  page,
}) => {
  await openWidget(page);
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();
  const helpButton = page.getByRole("button", { name: "Help me now" });
  const welcomeCorner = await helpButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      position: style.position,
      insetBlockEnd: style.insetBlockEnd,
      insetInlineEnd: style.insetInlineEnd,
    };
  });
  expect(welcomeCorner).toEqual({
    position: "fixed",
    insetBlockEnd: "12px",
    insetInlineEnd: "12px",
  });
  const englishChoice = page.getByRole("button", { name: "English" });
  await englishChoice.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(helpButton).toBeFocused();
  await englishChoice.click();
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
  await expect(helpButton).toHaveCSS("position", welcomeCorner.position);
  await expect(helpButton).toHaveCSS(
    "inset-block-end",
    welcomeCorner.insetBlockEnd,
  );
  await expect(helpButton).toHaveCSS(
    "inset-inline-end",
    welcomeCorner.insetInlineEnd,
  );
  const languageButton = page.getByRole("button", { name: "Change language" });
  await languageButton.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: packs.get("en")!.ui["faq.action"]! }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(helpButton).toBeFocused();
  await expect
    .poll(() =>
      helpButton.evaluate((element) => {
        const style = getComputedStyle(element);
        return { width: style.outlineWidth, offset: style.outlineOffset };
      }),
    )
    .toEqual({ width: "3px", offset: "2px" });
});

test("previews only the last three questions and sends help after confirmation", async ({
  page,
}) => {
  const { helpRequests } = await openWidget(page);
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();

  const questions = [
    "Question one",
    "Question two",
    "Question three",
    "Question four",
  ];
  for (const question of questions) {
    const composer = page.getByRole("textbox", { name: "Ask a question" });
    await composer.fill(question);
    await composer.press("Enter");
    await expect(
      page
        .locator("article[data-role='learner']")
        .filter({ hasText: question }),
    ).toBeVisible();
    await expect(
      page.locator("article[data-role='assistant']").last(),
    ).toContainText("Choose one topic to learn this week.");
  }

  await page.getByRole("button", { name: "Help me now" }).click();
  const dialog = page.getByRole("dialog", { name: "Ask a person for help?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Question one", { exact: true })).toHaveCount(
    0,
  );
  for (const question of questions.slice(1)) {
    await expect(dialog.getByText(question, { exact: true })).toBeVisible();
  }
  const { AxeBuilder } = await import("@axe-core/playwright");
  const previewAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    previewAccessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  const includeSummary = dialog.getByRole("checkbox", {
    name: "Include my last questions",
  });
  await expect(includeSummary).toBeChecked();
  await includeSummary.uncheck();
  await expect(dialog.getByText("Question two", { exact: true })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toHaveCount(0);
  expect(helpRequests).toEqual([]);

  await page.getByRole("button", { name: "Help me now" }).click();
  const confirmedDialog = page.getByRole("dialog", {
    name: "Ask a person for help?",
  });
  await confirmedDialog
    .getByRole("checkbox", { name: "Include my last questions" })
    .uncheck();
  await confirmedDialog.getByRole("button", { name: "Send request" }).click();

  await expect(
    page.getByText("A person will join soon.", { exact: false }),
  ).toBeVisible();
  expect(helpRequests).toEqual([
    { sessionId: "session-12345678", includeSummary: false },
  ]);
  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await composer.fill("Continue learning with the tutor.");
  await page
    .locator("form.composer")
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(
    page
      .locator("article[data-role='learner']")
      .filter({ hasText: "Continue learning with the tutor." }),
  ).toBeVisible();
  await expect(
    page.locator("article[data-role='assistant']").last(),
  ).toContainText("Choose one topic to learn this week.");
});

test("connects help chat, sends ordered messages, and closes the request", async ({
  page,
}) => {
  const socketFrames: Record<string, unknown>[] = [];
  await page.routeWebSocket("ws://api.test/v1/help/ws", (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      socketFrames.push(frame);
      if (frame.type === "auth") {
        socket.send(JSON.stringify({ type: "help.joined" }));
        socket.send(
          JSON.stringify({
            type: "chat.message",
            id: "helper-message-1",
            text: "I am here to help.",
            from: "helper",
          }),
        );
      }
    });
  });
  const { helpRequests, helpClosures } = await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Help me now" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Send request" })
    .click();

  await expect(page.getByText("Connected to a helper.")).toBeVisible();
  await expect(page.getByText("I am here to help.")).toBeVisible();
  await expect(page.getByText("New message from your helper.")).toBeVisible();
  await page.getByLabel("Message").fill("Thank you.");
  await page
    .locator("section[aria-labelledby='help-chat-heading']")
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(page.getByText("Thank you.", { exact: true })).toBeVisible();
  await expect
    .poll(() => socketFrames.filter((frame) => frame.type === "chat.message"))
    .toContainEqual({
      type: "chat.message",
      id: expect.any(String),
      text: "Thank you.",
    });

  await page.getByRole("button", { name: "End help" }).click();
  expect(helpRequests).toEqual([
    { sessionId: "session-12345678", includeSummary: true },
  ]);
  await expect
    .poll(() => helpClosures)
    .toEqual([{ sessionId: "session-12345678" }]);
});

test("reconnects help chat from the last received message without duplicates", async ({
  page,
}) => {
  const authFrames: Record<string, unknown>[] = [];
  let connectionCount = 0;
  await page.routeWebSocket("ws://api.test/v1/help/ws", (socket) => {
    connectionCount += 1;
    const connection = connectionCount;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      if (frame.type !== "auth") return;
      authFrames.push(frame);
      socket.send(JSON.stringify({ type: "help.joined" }));
      socket.send(
        JSON.stringify({
          type: "chat.message",
          id: "helper-message-1",
          text: "First helper response.",
          from: "helper",
        }),
      );
      if (connection === 1) {
        setTimeout(
          () => socket.close({ code: 1000, reason: "reconnect test" }),
          50,
        );
      } else {
        socket.send(
          JSON.stringify({
            type: "chat.message",
            id: "helper-message-2",
            text: "Second helper response.",
            from: "helper",
          }),
        );
      }
    });
  });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Help me now" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Send request" })
    .click();

  await expect(page.getByText("First helper response.")).toHaveCount(1);
  await expect(page.getByText("Second helper response.")).toBeVisible({
    timeout: 10_000,
  });
  await expect.poll(() => authFrames.length).toBeGreaterThanOrEqual(2);
  expect(authFrames[1]?.lastMessageId).toBe("helper-message-1");
  await expect(page.getByText("First helper response.")).toHaveCount(1);
});

test("returns the learner to tutor mode when the helper ends chat", async ({
  page,
}) => {
  await page.routeWebSocket("ws://api.test/v1/help/ws", (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      if (frame.type !== "auth") return;
      socket.send(JSON.stringify({ type: "help.joined" }));
      setTimeout(
        () => socket.send(JSON.stringify({ type: "help.closed" })),
        50,
      );
    });
  });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Help me now" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Send request" })
    .click();

  await expect(
    page.getByText(
      "This help chat has ended. You can continue with the tutor.",
    ),
  ).toBeVisible();
  await expect(
    page.locator("section[aria-labelledby='help-chat-heading']"),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Help me now" })).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
});

test("announces microphone state with its ring, tone, and haptic cues", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await installCueMocks(page);
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await attachPendingSpeech(page);

  const layout = await page.locator("dimts-assistant").evaluate((element) => {
    const mic = element
      .shadowRoot!.querySelector(".mic")!
      .getBoundingClientRect();
    const main = element
      .shadowRoot!.querySelector("main")!
      .getBoundingClientRect();
    return {
      micHeight: mic.height,
      micCenter: (mic.left + mic.right) / 2,
      mainCenter: (main.left + main.right) / 2,
    };
  });
  expect(layout.micHeight).toBeGreaterThanOrEqual(64);
  expect(Math.abs(layout.micCenter - layout.mainCenter)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Start talking" }).click();
  const stopButton = page.getByRole("button", { name: "Stop talking" });
  await expect(stopButton).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      stopButton.evaluate(
        (element) => getComputedStyle(element, "::after").animationName,
      ),
    )
    .toBe("recording-ring");
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__toneFrequencies))
    .toEqual([660]);
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__vibrationPatterns))
    .toEqual([30]);

  await stopButton.click();
  await expect(
    page.getByRole("button", { name: "Start talking" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__toneFrequencies))
    .toEqual([660, 440]);
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__vibrationPatterns))
    .toEqual([30, [30, 40, 30]]);
});

test("Stop motion disables the microphone ring and vibration", async ({
  page,
}) => {
  await installCueMocks(page);
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Stop motion").check();
  await page.getByRole("button", { name: "Settings" }).click();
  await attachPendingSpeech(page);

  await page.getByRole("button", { name: "Start talking" }).click();
  const stopButton = page.getByRole("button", { name: "Stop talking" });
  await expect(stopButton).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      stopButton.evaluate(
        (element) => getComputedStyle(element, "::after").animationName,
      ),
    )
    .toBe("none");
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__vibrationPatterns))
    .toEqual([]);
});

test("keeps microphone state visible when sound and motion are unavailable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
  });
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await attachPendingSpeech(page);

  await page.getByRole("button", { name: "Start talking" }).click();
  const stopButton = page.getByRole("button", { name: "Stop talking" });
  await expect(stopButton).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      stopButton.evaluate((element) => ({
        animation: getComputedStyle(element, "::after").animationName,
        background: getComputedStyle(element).backgroundColor,
      })),
    )
    .toMatchObject({ animation: "none" });
});

test("welcomes in-language, keeps the conversation, and focuses cited replies", async ({
  page,
}) => {
  await openWidget(page);
  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();

  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await expect(composer).toBeFocused();
  await composer.fill("How do I make a study plan?");
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue("How do I make a study plan?\n");
  await composer.fill("How do I make a study plan?");
  await composer.press("Enter");

  await expect(page.getByRole("article", { name: "You" })).toContainText(
    "How do I make a study plan?",
  );
  const reply = page.getByRole("article", { name: "Dimts" });
  await expect(reply).toContainText("Choose one topic to learn this week.");
  await expect(reply).toBeFocused();
  await expect(
    reply.getByRole("link", { name: "Source: Study plan / Choose one goal" }),
  ).toHaveAttribute("href", "https://course.test/study-plan#choose-one-goal");
  await expect(page.getByRole("log")).toHaveAttribute("aria-live", "polite");
});

test("reflows at 320px and has no critical or serious accessibility violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Settings" }).click();

  const root = page.locator("dimts-assistant");
  const layout = await root.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

  const { AxeBuilder } = await import("@axe-core/playwright");
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("names controls in their language and meets interactive target sizes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openWidget(page);
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();
  const assertTargets = async () => {
    const controls = await page
      .locator("dimts-assistant")
      .locator("button, a, input, select, textarea")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            width: bounds.width,
            height: bounds.height,
            lang: element.getAttribute("lang"),
            dir: element.getAttribute("dir"),
          };
        }),
      );

    expect(controls.length).toBeGreaterThan(0);
    expect(
      controls.filter(
        ({ width, height, lang, dir }) =>
          width < 48 ||
          height < 48 ||
          !lang ||
          (dir !== "ltr" && dir !== "rtl"),
      ),
    ).toEqual([]);
  };
  await assertTargets();
  await page.getByRole("button", { name: "English" }).click();
  await assertTargets();
  await page.getByRole("button", { name: "Settings" }).click();
  await assertTargets();
});

test("keeps at least 8px between interactive targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openWidget(page);
  const assertSpacing = async () => {
    const closePairs = await page
      .locator("dimts-assistant")
      .evaluate((element) => {
        const controls = Array.from(
          element.shadowRoot!.querySelectorAll<HTMLElement>(
            "button, a, input, select, textarea",
          ),
        )
          .filter((control) => control.getClientRects().length > 0)
          .flatMap((control) => {
            let { left, right, top, bottom } = control.getBoundingClientRect();
            // A scroll viewport reserves the fixed Help corner. Only the visible
            // intersection is interactive; clipped off-screen rows cannot overlap it.
            if (getComputedStyle(control).position !== "fixed") {
              for (
                let ancestor = control.parentElement;
                ancestor;
                ancestor = ancestor.parentElement
              ) {
                const style = getComputedStyle(ancestor);
                const bounds = ancestor.getBoundingClientRect();
                if (/(auto|scroll|hidden|clip)/u.test(style.overflowX)) {
                  left = Math.max(left, bounds.left);
                  right = Math.min(right, bounds.right);
                }
                if (/(auto|scroll|hidden|clip)/u.test(style.overflowY)) {
                  top = Math.max(top, bounds.top);
                  bottom = Math.min(bottom, bounds.bottom);
                }
              }
            }
            if (right <= left || bottom <= top) return [];
            return {
              label: control.textContent?.trim() || control.tagName,
              left,
              right,
              top,
              bottom,
            };
          });

        const close: string[] = [];
        for (let first = 0; first < controls.length; first += 1) {
          for (let second = first + 1; second < controls.length; second += 1) {
            const a = controls[first]!;
            const b = controls[second]!;
            const gapInline = Math.max(0, a.left - b.right, b.left - a.right);
            const gapBlock = Math.max(0, a.top - b.bottom, b.top - a.bottom);
            if (gapInline < 8 && gapBlock < 8) {
              close.push(`${a.label} / ${b.label}`);
            }
          }
        }
        return close;
      });

    expect(closePairs).toEqual([]);
  };
  await assertSpacing();
  await page.getByRole("button", { name: "English" }).click();
  await assertSpacing();
  await page.getByRole("button", { name: "Settings" }).click();
  await assertSpacing();
  await page.locator("#settings-shortcuts").focus();
  const focused = await page.locator("#settings-shortcuts").boundingBox();
  const help = await page
    .getByRole("button", { name: "Help me now" })
    .boundingBox();
  expect(focused!.y + focused!.height).toBeLessThanOrEqual(help!.y - 8);
});

test("remembers a language choice across page loads", async ({ page }) => {
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "200 percent" }).click();
  await page.reload();

  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("button", { name: "200 percent" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("speaks the language name on focus when that language has TTS", async ({
  page,
}) => {
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    const testWindow = window as TestWindow;
    testWindow.__spoken = [];
    widget.textToSpeech = {
      supported: (lang) => lang === "en",
      speak: async (text, lang, rate) => {
        testWindow.__spoken?.push({ text, lang, rate });
      },
      pause: () => {},
      resume: () => {},
      stop: () => {},
    };
    await widget.updateComplete;
  });

  await page.getByRole("button", { name: "English" }).focus();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__spoken))
    .toEqual([{ text: "English", lang: "en", rate: 1 }]);
});

test("changing language keeps chat history and returns focus to the picker", async ({
  page,
}) => {
  await openWidget(page, { languages: languageChoices });
  await page.getByRole("button", { name: "English" }).click();
  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await composer.fill("How do I make a study plan?");
  await composer.press("Enter");
  const learnerMessage = page
    .locator("dimts-assistant")
    .locator('article[data-role="learner"]');
  await expect(learnerMessage).toContainText("How do I make a study plan?");

  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("button", { name: "አማርኛ" }).click();
  await expect(learnerMessage).toContainText("How do I make a study plan?");
  await expect(learnerMessage).toHaveAttribute("lang", "en");
  await expect
    .poll(() =>
      page
        .locator("dimts-assistant")
        .locator(".header-actions button")
        .first()
        .evaluate((element) => element === element.getRootNode().activeElement),
    )
    .toBe(true);
});

test("loads a self-hosted Ethiopic font only when Amharic is active", async ({
  page,
}) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") {
      fontRequests.push(new URL(request.url()).origin);
    }
  });
  await openWidget(page, { languages: languageChoices });
  await page.getByRole("button", { name: "English" }).click();
  await expect.poll(() => fontRequests.length).toBe(0);

  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("button", { name: "አማርኛ" }).click();
  await page
    .getByRole("button", { name: packs.get("am")!.ui["language.button"]! })
    .click();
  await expect(page.getByRole("button", { name: "አማርኛ" })).toBeVisible();
  await expect.poll(() => fontRequests.length).toBeGreaterThan(0);
  expect(new Set(fontRequests)).toEqual(new Set(["http://127.0.0.1:4173"]));
});

test("reflows at 200 percent text size on a 320px viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "200 percent" }).click();

  const layout = await page.locator("dimts-assistant").evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scale: getComputedStyle(element).getPropertyValue("--dimts-scale").trim(),
  }));
  expect(layout.scale).toBe("2");
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test("keeps default and high-contrast text at 7:1 without fading disabled controls", async ({
  page,
}) => {
  await openWidget(page);
  const widget = page.locator("dimts-assistant");
  const getPalette = () =>
    widget.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        surface: style.getPropertyValue("--dimts-surface").trim(),
        text: style.getPropertyValue("--dimts-text").trim(),
        muted: style.getPropertyValue("--dimts-muted").trim(),
        primary: style.getPropertyValue("--dimts-primary").trim(),
        primaryText: style.getPropertyValue("--dimts-primary-text").trim(),
      };
    });

  const assertPalette = async () => {
    const palette = await getPalette();
    expect(contrastRatio(palette.text, palette.surface)).toBeGreaterThanOrEqual(
      7,
    );
    expect(
      contrastRatio(palette.muted, palette.surface),
    ).toBeGreaterThanOrEqual(7);
    expect(
      contrastRatio(palette.primaryText, palette.primary),
    ).toBeGreaterThanOrEqual(7);
  };

  await assertPalette();
  await page.getByRole("button", { name: "English" }).click();
  await expect(widget.locator(".mic")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  const unavailableReadAloud = page.getByLabel("Read replies aloud");
  await expect(unavailableReadAloud).toBeDisabled();
  await expect
    .poll(() =>
      unavailableReadAloud.evaluate(
        (element) => getComputedStyle(element).opacity,
      ),
    )
    .toBe("1");
  await page.getByLabel("High contrast").check();
  await assertPalette();
});

test("works when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("storage unavailable");
      },
    });
  });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
});

test("announces failed asks with retry and help actions", async ({ page }) => {
  await openWidget(page, { failFirstAsk: true });
  await page.getByRole("button", { name: "English" }).click();
  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await composer.fill("How do I make a study plan?");
  await composer.press("Enter");

  await expect(page.getByRole("alert")).toContainText(
    "The service could not be reached",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Help me now" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("article", { name: "Dimts" })).toContainText(
    "Choose one topic to learn this week.",
  );
});

test("suggests a language for typed text without switching until chosen", async ({
  page,
}) => {
  const askLangs: string[] = [];
  await openWidget(page, { languages: languageChoices });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/ask")) {
      askLangs.push(String(request.postDataJSON().lang));
    }
  });
  await page.getByRole("button", { name: "English" }).click();

  const composer = page.locator("#message");
  await composer.fill("Hello there");
  await expect(page.getByText("Choose English or Afaan Oromoo.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Afaan Oromoo" }),
  ).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("lang", "en");

  await page.getByRole("button", { name: "Afaan Oromoo" }).click();
  await expect(page.locator("main")).toHaveAttribute("lang", "om");
  await expect(composer).toHaveValue("Hello there");
  await composer.press("Enter");
  await expect(page.getByRole("article", { name: "Dimts" })).toBeVisible();
  expect(askLangs).toEqual(["om"]);
});

test("announces offline state and exposes recovery on the welcome screen", async ({
  page,
}) => {
  await openWidget(page);
  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator(".offline-banner")).toContainText(
    "You are offline",
  );
  await expect(page.getByRole("button", { name: "Help me now" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".offline-banner")).toHaveCount(0);
});

test("reopens from cached language data when the API is offline", async ({
  page,
}) => {
  const widget = await openWidget(page);
  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const keys = await caches.keys();
        const cached = await Promise.all(
          keys.map(async (name) => (await caches.open(name)).keys()),
        );
        return cached.flat().length;
      }),
    )
    .toBeGreaterThan(0);
  widget.disconnectApi();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Choose your language" }),
  ).toBeVisible();
  await expect(page.locator(".offline-banner")).toContainText(
    "You are offline",
  );
  const registered = await page.evaluate(async () =>
    Boolean(await navigator.serviceWorker?.getRegistration("/")),
  );
  expect(registered).toBe(true);
});

test("reads replies aloud only after the learner selects the read-aloud mode", async ({
  page,
}) => {
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    const testWindow = window as TestWindow;
    testWindow.__spoken = [];
    testWindow.__speechControls = {
      pauses: 0,
      resumes: 0,
      stops: 0,
    };
    widget.textToSpeech = {
      supported: (lang) => lang === "en",
      speak: (text, lang, rate) => {
        testWindow.__spoken?.push({ text, lang, rate });
        return new Promise<void>((resolve) => {
          if (testWindow.__speechControls) {
            testWindow.__speechControls.finish = resolve;
          }
        });
      },
      pause: () => {
        if (testWindow.__speechControls) {
          testWindow.__speechControls.pauses += 1;
        }
      },
      resume: () => {
        if (testWindow.__speechControls) {
          testWindow.__speechControls.resumes += 1;
        }
      },
      stop: () => {
        if (testWindow.__speechControls) {
          testWindow.__speechControls.stops += 1;
          testWindow.__speechControls.finish?.();
        }
      },
    };
    await widget.updateComplete;
  });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Read replies aloud").selectOption("ask");
  await page.getByLabel("Speech speed").selectOption("1.25");
  await page.getByRole("button", { name: "Settings" }).click();

  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await composer.fill("How do I make a study plan?");
  await composer.press("Enter");
  await page.getByRole("button", { name: "Read reply aloud" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__spoken))
    .toEqual([
      {
        text: "Choose one topic to learn this week.",
        lang: "en",
        rate: 1.25,
      },
    ]);
  await page.getByRole("button", { name: "Pause reading" }).click();
  await page.getByRole("button", { name: "Resume reading" }).click();
  await page.getByRole("button", { name: "Stop reading" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__speechControls))
    .toMatchObject({ pauses: 1, resumes: 1, stops: 1 });
});

test("hides unconfigured voice while typed questions still work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let mediaRequests = 0;
    Object.defineProperty(window, "__mediaRequests", {
      get: () => mediaRequests,
    });
    if (navigator.mediaDevices) {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          mediaRequests += 1;
          throw new Error("unexpected microphone request");
        },
      });
    }
  });
  await openWidget(page);
  await page.getByRole("button", { name: "English" }).click();

  await expect(page.getByRole("button", { name: "Start talking" })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Voice input is not enabled for this language."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Read replies aloud")).toBeDisabled();
  await expect(page.getByLabel("Speech speed")).toBeDisabled();
  await expect(
    page.getByText("Read aloud is not enabled for this language."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();

  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await composer.fill("How do I make a study plan?");
  await composer.press("Enter");
  await expect(page.getByRole("article", { name: "Dimts" })).toContainText(
    "Choose one topic to learn this week.",
  );
  expect(
    await page.evaluate(
      () => (window as Window & { __mediaRequests?: number }).__mediaRequests,
    ),
  ).toBe(0);
});

test("hides injected adapters that do not support the selected language", async ({
  page,
}) => {
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    widget.speechToText = {
      supported: () => false,
      start: async () => "",
      stop: () => {},
    };
    widget.textToSpeech = {
      supported: () => false,
      speak: async () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {},
    };
    await widget.updateComplete;
  });

  await expect(page.getByRole("button", { name: "Start talking" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Read replies aloud")).toBeDisabled();
});

test("reviews editable speech text and submits only the learner-edited text", async ({
  page,
}) => {
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    const testWindow = window as TestWindow;
    testWindow.__voice = { starts: [], stops: 0 };
    testWindow.__spoken = [];
    widget.speechToText = {
      supported: (lang) => lang === "en",
      start: (lang) =>
        new Promise((resolve) => {
          testWindow.__voice?.starts.push(lang);
          if (testWindow.__voice) {
            testWindow.__voice.resolve = resolve;
          }
        }),
      stop: () => {
        if (testWindow.__voice) {
          testWindow.__voice.stops += 1;
          testWindow.__voice.resolve?.("How do I plan my study?");
        }
      },
    };
    widget.textToSpeech = {
      supported: (lang) => lang === "en",
      speak: async (text, lang, rate) => {
        testWindow.__spoken?.push({ text, lang, rate });
      },
      pause: () => {},
      resume: () => {},
      stop: () => {},
    };
    await widget.updateComplete;
  });

  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(
    page.getByRole("button", { name: "Stop talking" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop talking" }).click();
  await expect(
    page.getByText("I heard: How do I plan my study?"),
  ).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await expect(composer).toHaveValue("How do I plan my study?");
  await page.getByRole("button", { name: "Say it again" }).click();
  await page.getByRole("button", { name: "Stop talking" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__voice?.starts))
    .toEqual(["en", "en"]);
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__spoken))
    .toEqual([
      { text: "How do I plan my study?", lang: "en", rate: 1 },
      { text: "How do I plan my study?", lang: "en", rate: 1 },
    ]);
  await composer.fill("How do I plan my study this week?");

  const submitted: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/ask")) {
      submitted.push(JSON.stringify(request.postDataJSON()));
    }
  });
  await composer.press("Enter");
  await expect(page.getByRole("article", { name: "Dimts" })).toBeVisible();
  expect(submitted.join(" ")).toContain("How do I plan my study this week?");
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__voice?.stops))
    .toBe(2);
  expect(
    await page.evaluate(() => JSON.stringify(Object.values(localStorage))),
  ).not.toContain("How do I plan my study");
});

test("stops a recording at 60 seconds and announces silence for retry", async ({
  page,
}) => {
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    const testWindow = window as TestWindow;
    testWindow.__voice = { starts: [], stops: 0 };
    testWindow.__spoken = [];
    widget.speechToText = {
      supported: (lang) => lang === "en",
      start: (lang) =>
        new Promise((resolve) => {
          testWindow.__voice?.starts.push(lang);
          if (testWindow.__voice) {
            testWindow.__voice.resolve = resolve;
          }
        }),
      stop: () => {
        if (testWindow.__voice) {
          testWindow.__voice.stops += 1;
          testWindow.__voice.resolve?.("");
        }
      },
    };
    widget.textToSpeech = {
      supported: (lang) => lang === "en",
      speak: async (text, lang, rate) => {
        testWindow.__spoken?.push({ text, lang, rate });
      },
      pause: () => {},
      resume: () => {},
      stop: () => {},
    };
    await widget.updateComplete;
  });
  await page.clock.install();
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(
    page.getByRole("button", { name: "Stop talking" }),
  ).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("alert")).toContainText("Please say it again.");
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__voice?.stops))
    .toBe(1);
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__spoken))
    .toEqual([{ text: "Please say it again.", lang: "en", rate: 1 }]);
});

test("automatically reads replies when the learner enables that setting", async ({
  page,
}) => {
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    const testWindow = window as TestWindow;
    testWindow.__spoken = [];
    widget.textToSpeech = {
      supported: (lang) => lang === "en",
      speak: async (text, lang, rate) => {
        testWindow.__spoken?.push({ text, lang, rate });
      },
      pause: () => {},
      resume: () => {},
      stop: () => {},
    };
    await widget.updateComplete;
  });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Read replies aloud").selectOption("always");
  await page.getByRole("button", { name: "Settings" }).click();
  const composer = page.getByRole("textbox", { name: "Ask a question" });
  await composer.fill("How do I make a study plan?");
  await composer.press("Enter");

  await expect(page.getByRole("article", { name: "Dimts" })).toContainText(
    "Choose one topic to learn this week.",
  );
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__spoken))
    .toEqual([
      {
        text: "Choose one topic to learn this week.",
        lang: "en",
        rate: 1,
      },
    ]);
});

test("explains microphone denial and keeps text entry available", async ({
  page,
}) => {
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    widget.speechToText = {
      supported: (lang) => lang === "en",
      start: async () => {
        throw Object.assign(new Error("denied"), { code: "permission-denied" });
      },
      stop: () => {},
    };
    await widget.updateComplete;
  });
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Microphone access was denied. You can continue by typing or enable microphone access in your browser settings.",
  );
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
});

test("explains when no microphone is available and preserves text entry", async ({
  page,
}) => {
  await openWidget(page, { languages: voiceEnabledTestLanguages });
  await page.getByRole("button", { name: "English" }).click();
  await page.locator("dimts-assistant").evaluate(async (element) => {
    const widget = element as WidgetElement;
    widget.speechToText = {
      supported: (lang) => lang === "en",
      start: async () => {
        throw Object.assign(new Error("missing"), {
          code: "microphone-unavailable",
        });
      },
      stop: () => {},
    };
    await widget.updateComplete;
  });
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "No microphone was found. Continue by typing or connect a microphone and try again.",
  );
  await expect(
    page.getByRole("textbox", { name: "Ask a question" }),
  ).toBeVisible();
});
