import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { resolve } from "node:path";
import { loadPacks } from "../../locales-tools/src/index.js";

const packs = loadPacks(resolve("locales"));
const ui = packs.get("en")!.ui;
// Draft packs are enabled only as fixtures; these checks are not translation review.
async function openCareer(
  page: Page,
  channels = ["sms", "telegram"],
  code = "en",
  failFirstSend = false,
) {
  const pack = packs.get(code)!;
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  let active = false;
  const drafts = new Map<string, Record<string, unknown>>();
  let sendFailed = false;
  await page.route("http://127.0.0.1:4173/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>Career test</title></head><body><dimts-assistant data-api="http://api.test/v1" data-host-key="test-host"></dimts-assistant><script type="module" src="/dimts-widget.js"></script></body></html>',
    }),
  );
  await page.route("http://api.test/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON() as Record<string, unknown>) ?? {};
    calls.push({ path: request.url(), method: request.method(), body });
    if (path.endsWith("/languages"))
      return route.fulfill({
        json: {
          languages: [
            {
              code,
              nameNative: pack.meta.name_native,
              nameEn: pack.meta.name_en,
              script: pack.meta.script,
              dir: pack.meta.dir,
              status: "beta",
              stt: true,
              tts: false,
            },
          ],
        },
      });
    if (path.endsWith("/ui")) return route.fulfill({ json: pack.ui });
    if (path.endsWith("/sessions"))
      return route.fulfill({
        json: {
          sessionId: "session-12345678",
          sessionToken: "session-token",
          resumeToken: "resume-token",
          lang: "en",
          cloudOk: false,
          consentVersion: null,
        },
      });
    if (path.endsWith("/jobs"))
      return route.fulfill({
        json: {
          jobs: [
            {
              id: "job-a",
              title: "Office trainee",
              description: "Training role",
              organization: "Example",
              location: "Addis",
              region: "Addis",
              jobType: "training",
              datePosted: "2026-11-01",
              deadline: "2026-11-14",
              deadlineDisplay: "14 November 2026 (5 Hidar 2019)",
              url: "https://example.org/jobs/a",
              lang: "en",
              accommodationsOffered: ["step_free_access"],
            },
            {
              id: "job-b",
              title: "Shop assistant",
              description: "Local role",
              organization: "Example",
              location: "Adama",
              region: "Adama",
              jobType: "full-time",
              datePosted: "2026-11-01",
              deadline: null,
              url: "https://example.org/jobs/b",
              lang: "en",
              accommodationsOffered: [],
            },
          ],
          channels,
          relayAvailable: channels.length > 0,
          glossary: [
            {
              id: "deadline",
              term: "Deadline",
              meaning: "The last day to apply.",
            },
          ],
        },
      });
    if (path.endsWith("/subscriptions") && request.method() === "GET")
      return route.fulfill({
        json: {
          subscriptions: active
            ? [{ id: "sub-a", status: "active", lang: "en", channel: "sms" }]
            : [],
        },
      });
    if (path.endsWith("/subscriptions") && request.method() === "POST") {
      active = true;
      return route.fulfill({ json: { id: "sub-a", status: "active" } });
    }
    if (path.includes("/subscriptions/") && request.method() === "DELETE") {
      active = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/accommodation-requests") && request.method() === "GET")
      return route.fulfill({
        json: {
          requests: [...drafts.values()].map((draft) => ({
            id: draft.id,
            jobId: draft.jobId,
            status: draft.status,
          })),
        },
      });
    if (path.endsWith("/accommodation-requests")) {
      let savedDraft = drafts.get(String(body.id));
      if (body.action === "draft") {
        savedDraft = {
          id: `draft-${drafts.size + 1}`,
          revision: 1,
          status: "draft",
          sendAttempted: false,
          message: `Please provide step-free access for this interview.${body.name ? ` Name: ${String(body.name)}` : ""}`,
          jobId: "job-a",
          needs: body.needs,
          otherText: body.otherText,
          name: body.name,
          interviewAt: body.interviewAt,
        };
        drafts.set(String(savedDraft.id), savedDraft);
      }
      if (savedDraft && body.action === "send") savedDraft.sendAttempted = true;
      if (
        savedDraft &&
        body.action === "send" &&
        failFirstSend &&
        !sendFailed
      ) {
        sendFailed = true;
        return route.fulfill({ status: 503, json: {} });
      }
      if (savedDraft && body.action !== "resume" && body.action !== "draft")
        savedDraft.status =
          body.action === "send"
            ? "sent"
            : body.action === "approve"
              ? "approved"
              : "cancelled";
      return route.fulfill({
        json: savedDraft ?? {},
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("http://127.0.0.1:4173/");
  await page.getByRole("button", { name: pack.meta.name_native }).click();
  await page
    .getByRole("button", { name: pack.ui["jobs.title"], exact: true })
    .click();
  await expect(page.getByText("Office trainee", { exact: true })).toBeVisible();
  return calls;
}

test("P06 private local support filter and accessible dual-calendar catalog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const calls = await openCareer(page);
  const before = calls.length;
  await page
    .getByLabel(ui["jobs.supportLabels.step_free"]!, { exact: true })
    .check();
  await expect(page.getByText("Shop assistant", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("14 November 2026 (5 Hidar 2019)", { exact: false }),
  ).toBeVisible();
  expect(calls).toHaveLength(before);
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  expect(stored).not.toContain("step_free");
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((x) =>
      ["serious", "critical"].includes(x.impact ?? ""),
    ),
  ).toEqual([]);
});

test("P06 consent precedes contact; safe resume and durable stop", async ({
  page,
}) => {
  const calls = await openCareer(page);
  await page
    .getByRole("button", { name: ui["jobs.alerts"], exact: true })
    .click();
  await page.getByLabel(ui["jobs.type"]!, { exact: true }).fill("training");
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page.getByLabel(ui["jobs.region"]!, { exact: true }).fill("Addis");
  await page
    .getByRole("button", { name: ui["jobs.save"], exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: ui["jobs.title"], exact: true })
    .click();
  expect(
    calls.filter((call) => call.path.endsWith("/sessions")).at(-1)?.body,
  ).toEqual({ sessionId: "session-12345678", resumeToken: "resume-token" });
  await page
    .getByRole("button", { name: ui["jobs.resume"], exact: true })
    .click();
  await expect(
    page.getByLabel(ui["jobs.region"]!, { exact: true }),
  ).toHaveValue("Addis");
  for (let i = 0; i < 3; i++)
    await page
      .getByRole("button", { name: ui["jobs.next"], exact: true })
      .click();
  await expect(
    page.getByLabel(ui["jobs.contact"]!, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: ui["jobs.next"], exact: true }),
  ).toBeDisabled();
  await page.getByLabel(ui["jobs.consent"]!, { exact: true }).check();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByLabel(ui["jobs.contact"]!, { exact: true })
    .fill("+251911111111");
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.subscribe"], exact: true })
    .click();
  expect(
    calls.find((x) => x.method === "POST" && x.path.endsWith("/subscriptions"))
      ?.body.consent,
  ).toEqual({ accepted: true, noticeVersion: "job-alerts-v1" });
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("251911111111");
  await page.reload();
  await page
    .getByRole("button", { name: ui["jobs.title"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.stop"], exact: true })
    .click();
  await expect(
    page.getByText(ui["jobs.stopped"]!, { exact: true }),
  ).toBeVisible();
});

test("P06 anonymous accommodation requires exact review then approval before sending", async ({
  page,
}) => {
  const calls = await openCareer(page);
  await page
    .getByRole("button", { name: ui["jobs.accommodation"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByLabel(ui["jobs.supportLabels.step_free"]!, { exact: true })
    .check();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByLabel(ui["jobs.interviewAt"]!, { exact: true })
    .fill("2026-11-14T09:00");
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await expect(
    page.getByText("Please provide step-free access for this interview.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(calls.filter((x) => x.body.action === "send")).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: ui["jobs.send"], exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: ui["jobs.approve"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.send"], exact: true })
    .click();
  expect(
    calls.find((x) => x.body.action === "draft")?.body.name,
  ).toBeUndefined();
  expect(calls.filter((x) => x.body.action === "send")).toHaveLength(1);
  await expect(page.getByText(ui["jobs.sent"]!, { exact: true })).toBeVisible();
});

test("P06 unavailable relay does not offer pretend delivery", async ({
  page,
}) => {
  const calls = await openCareer(page, []);
  await expect(
    page.getByRole("button", { name: ui["jobs.alerts"], exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: ui["jobs.accommodation"], exact: true }),
  ).toBeDisabled();
  expect(
    calls.filter((x) => x.method === "POST" && !x.path.endsWith("/sessions")),
  ).toHaveLength(0);
});

test("P06 voice answers are editable before Next and hiding discards late private speech", async ({
  page,
}) => {
  const calls = await openCareer(page);
  await page.evaluate(() => {
    const fixture = {
      starts: 0,
      cancels: 0,
      finish: (() => {}) as (text: string) => void,
    };
    (window as unknown as { careerVoice: typeof fixture }).careerVoice =
      fixture;
    const widget = document.querySelector("dimts-assistant") as unknown as {
      speechToText: unknown;
    };
    widget.speechToText = {
      supported: () => true,
      start: () => {
        fixture.starts++;
        return new Promise<string>((resolve) => {
          fixture.finish = resolve;
        });
      },
      stop: () => {},
      cancel: () => {
        fixture.cancels++;
      },
    };
  });
  await page
    .getByRole("button", { name: ui["jobs.alerts"], exact: true })
    .click();
  const flow = page.locator(".career-flow");
  await flow
    .getByRole("button", { name: ui["mic.start"], exact: true })
    .click();
  await expect(
    flow.getByRole("button", { name: ui["jobs.next"], exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (
      window as unknown as { careerVoice: { finish: (text: string) => void } }
    ).careerVoice.finish("training"),
  );
  await expect(flow.getByLabel(ui["jobs.type"]!, { exact: true })).toHaveValue(
    "training",
  );
  await expect(
    flow.getByText("I heard: training", { exact: true }),
  ).toBeVisible();
  await flow
    .getByLabel(ui["jobs.type"]!, { exact: true })
    .fill("apprenticeship");
  await flow
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await expect(
    flow.getByLabel(ui["jobs.region"]!, { exact: true }),
  ).toBeFocused();
  await flow
    .getByRole("button", { name: ui["mic.start"], exact: true })
    .click();
  await page.evaluate(() =>
    document.querySelector("dimts-assistant")?.setAttribute("hidden", ""),
  );
  await page.evaluate(() =>
    (
      window as unknown as { careerVoice: { finish: (text: string) => void } }
    ).careerVoice.finish("private late transcript"),
  );
  await page.evaluate(() =>
    document.querySelector("dimts-assistant")?.removeAttribute("hidden"),
  );
  await page
    .getByRole("button", { name: ui["jobs.title"], exact: true })
    .click();
  await expect(
    page.getByText("private late transcript", { exact: false }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { careerVoice: { cancels: number } }).careerVoice
          .cancels,
    ),
  ).toBe(1);
  expect(
    calls.filter(
      (call) => call.method === "POST" && !call.path.endsWith("/sessions"),
    ),
  ).toHaveLength(0);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("private late transcript");
});

test("P06 expired per-tab resume clears owned progress before a fresh session", async ({
  page,
}) => {
  await openCareer(page);
  await page
    .getByRole("button", { name: ui["jobs.alerts"], exact: true })
    .click();
  await page.getByLabel(ui["jobs.type"]!, { exact: true }).fill("training");
  await page
    .getByRole("button", { name: ui["jobs.save"], exact: true })
    .click();
  const resumes: Record<string, unknown>[] = [];
  await page.route("http://api.test/v1/sessions", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    resumes.push(body);
    return body.resumeToken
      ? route.fulfill({ status: 401, json: {} })
      : route.fulfill({
          json: {
            sessionId: "fresh-session",
            sessionToken: "fresh-token",
            resumeToken: "fresh-resume",
            cloudOk: false,
          },
        });
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: ui["jobs.title"], exact: true }),
  ).toBeVisible();
  expect(resumes).toEqual([
    { sessionId: "session-12345678", resumeToken: "resume-token" },
    { lang: "en", channel: "web" },
  ]);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("dimts.career."),
      ),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) =>
        key.startsWith("dimts.career-session."),
      ),
    ),
  ).toEqual([]);
});

test("P06 private draft resumes from server with no private browser storage", async ({
  page,
}) => {
  const calls = await openCareer(page);
  await page
    .getByRole("button", { name: ui["jobs.accommodation"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByLabel(ui["jobs.supportLabels.other"]!, { exact: true })
    .check();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByLabel(ui["jobs.other"]!, { exact: true })
    .fill("Private seating request");
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page.getByLabel(ui["jobs.name"]!, { exact: true }).fill("Private name");
  await page
    .getByRole("button", { name: ui["jobs.save"], exact: true })
    .click();
  await expect(
    page.getByText(ui["jobs.saved"]!, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toMatch(/Private|otherText|needs/);
  await page.reload();
  await page
    .getByRole("button", { name: ui["jobs.title"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.resume"], exact: true })
    .click();
  await expect(
    page.getByText(
      "Please provide step-free access for this interview. Name: Private name",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: ui["jobs.back"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.back"], exact: true })
    .click();
  await expect(page.getByLabel(ui["jobs.name"]!, { exact: true })).toHaveValue(
    "Private name",
  );
  await page
    .getByRole("button", { name: ui["jobs.cancel"], exact: true })
    .click();
  expect(calls.filter((call) => call.body.action === "send")).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: ui["jobs.resume"], exact: true }),
  ).toHaveCount(0);
});

test("P06 editing a reviewed request requires a new exact review and approval", async ({
  page,
}) => {
  const calls = await openCareer(page);
  await page
    .getByRole("button", { name: ui["jobs.accommodation"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByLabel(ui["jobs.supportLabels.step_free"]!, { exact: true })
    .check();
  for (let step = 0; step < 4; step++)
    await page
      .getByRole("button", { name: ui["jobs.next"], exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: ui["jobs.approve"], exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: ui["jobs.back"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.back"], exact: true })
    .click();
  await page.getByLabel(ui["jobs.name"]!, { exact: true }).fill("Chosen name");
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await expect(
    page.getByText(
      "Please provide step-free access for this interview. Name: Chosen name",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: ui["jobs.send"], exact: true }),
  ).toHaveCount(0);
  const drafts = calls.filter((call) => call.body.action === "draft");
  expect(drafts).toHaveLength(2);
  expect(drafts[0]!.body.clientRequestId).not.toBe(
    drafts[1]!.body.clientRequestId,
  );
  expect(calls.find((call) => call.body.action === "cancel")?.body.id).toBe(
    "draft-1",
  );
  expect(calls.filter((call) => call.body.action === "send")).toHaveLength(0);
  await page
    .getByRole("button", { name: ui["jobs.approve"], exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: ui["jobs.back"], exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: ui["jobs.send"], exact: true })
    .click();
  expect(calls.find((call) => call.body.action === "send")?.body.id).toBe(
    "draft-2",
  );
});

test("P06 uncertain delivery resumes with editing locked and retries the same request", async ({
  page,
}) => {
  const calls = await openCareer(page, ["sms", "telegram"], "en", true);
  await page
    .getByRole("button", { name: ui["jobs.accommodation"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.next"], exact: true })
    .click();
  await page
    .getByLabel(ui["jobs.supportLabels.step_free"]!, { exact: true })
    .check();
  for (let step = 0; step < 4; step++)
    await page
      .getByRole("button", { name: ui["jobs.next"], exact: true })
      .click();
  await page
    .getByRole("button", { name: ui["jobs.approve"], exact: true })
    .click();
  await page
    .getByRole("button", { name: ui["jobs.send"], exact: true })
    .click();
  await expect(
    page.getByText(ui["jobs.deliveryUncertain"]!, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: ui["jobs.back"], exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: ui["jobs.cancel"], exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page
    .getByRole("button", { name: ui["jobs.title"], exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `${ui["jobs.draft"]}: Office trainee`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: ui["jobs.cancel"], exact: true }),
  ).toBeDisabled();
  await page
    .locator(".career-flow")
    .getByRole("button", { name: ui["error.retry"], exact: true })
    .click();
  await expect(page.getByText(ui["jobs.sent"]!, { exact: true })).toBeVisible();
  expect(
    calls
      .filter((call) => call.body.action === "send")
      .map((call) => call.body.id),
  ).toEqual(["draft-1", "draft-1"]);
  expect(calls.filter((call) => call.body.action === "draft")).toHaveLength(1);
});

for (const code of ["en", "am", "om", "ar-test"])
  test(`P06 ${code} career reflow and keyboard focus at 200%`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openCareer(page, ["sms", "telegram"], code);
    const copy = packs.get(code)!.ui;
    await page.evaluate(() => {
      const widget = document.querySelector("dimts-assistant") as HTMLElement;
      widget.style.setProperty("font-size", "32px");
    });
    await page
      .getByRole("button", { name: copy["jobs.alerts"], exact: true })
      .click();
    await expect(
      page.getByLabel(copy["jobs.type"]!, { exact: true }),
    ).toBeFocused();
    await page.keyboard.type("training");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(
      page.getByLabel(copy["jobs.region"]!, { exact: true }),
    ).toBeFocused();
    expect(
      await page
        .locator(".career")
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
  });
