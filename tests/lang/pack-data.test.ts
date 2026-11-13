import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { loadPacks } from "../../packages/locales-tools/src/index.js";
import { requiredUiKeys } from "../../packages/locales-tools/src/required-ui-keys.js";
import { toPassages } from "../../packages/grounding/src/ingest.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const packs = loadPacks(path.join(root, "locales"));

// P03: consent and recovery must remain usable in every supported UI locale.
it("P03 provides localized consent, reply actions and keyboard settings", () => {
  const keys = [
    "privacy.remoteNotice",
    "privacy.cloudOk",
    "privacy.localOnly",
    "privacy.saving",
    "privacy.saved",
    "privacy.failed",
    "privacy.sessionRestarted",
    "answer.copy",
    "answer.copied",
    "answer.copyFailed",
    "answer.helpful",
    "answer.notHelpful",
    "answer.feedbackSaved",
    "answer.feedbackFailed",
    "settings.shortcuts",
    "settings.shortcutsHelp",
  ];
  for (const pack of packs.values()) {
    for (const key of keys)
      expect(pack.ui[key], `${pack.meta.code}: ${key}`).toBeTruthy();
  }
  expect(packs.get("en")!.ui["privacy.remoteNotice"]).toMatch(
    /question.*course passages/u,
  );
});
const source = readFileSync(
  path.join(root, "content/sample-course/study-plan.md"),
  "utf8",
);
const passages = toPassages({
  lessonId: "study-plan",
  content: source,
  format: "markdown",
  baseUrl: "https://example.test/course/",
  lang: "en",
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(filename)
      : entry.name.endsWith(".ts")
        ? [filename]
        : [];
  });
}

// Computed keys and keys passed through local variables cannot all be resolved
// from call arguments. Keep this list aligned with the actual input domains.
const computedKeys = [
  ...[100, 150, 200].map((scale) => `settings.scale${scale}`),
  ...["web", "api"].map((channel) => `helper.channel.${channel}`),
  ...["connecting", "connected", "reconnecting"].map(
    (state) => `help.${state}`,
  ),
  "conversation.escalation",
  "conversation.distress",
];

function consumedTranslationKeys(): Set<string> {
  const keys = new Set(computedKeys);
  function collect(node: ts.Node) {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+$/u.test(node.text)
    )
      keys.add(node.text);
    ts.forEachChild(node, collect);
  }
  for (const area of ["api", "engine", "widget"]) {
    for (const filename of sourceFiles(
      path.join(root, `packages/${area}/src`),
    )) {
      const sourceFile = ts.createSourceFile(
        filename,
        readFileSync(filename, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const method = ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : ts.isIdentifier(callee)
              ? callee.text
              : "";
          const argumentIndexes =
            method === "t" || method === "renderToggle"
              ? [0]
              : method === "translate"
                ? [ts.isPropertyAccessExpression(callee) ? 1 : 2]
                : method === "sendProblem"
                  ? [3]
                  : method === "createReply"
                    ? [4, 5]
                    : [];
          for (const index of argumentIndexes) {
            const argument = node.arguments[index];
            if (argument) collect(argument);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
    }
  }
  return keys;
}

// P01: FR-LANG-01/03/04/09/11/16/17, FR-CONV-05/07, FR-TUTOR-08/10,
// FR-AI-04/FR-UI-16. These are draft-data checks, not human review evidence.
describe("P01 authored locale data", () => {
  it("provides every consumed API, engine and widget translation key in every pack", () => {
    const keys = consumedTranslationKeys();
    // Guard against an empty or incorrectly scoped source scan.
    expect(keys).toContain("answer.notfound");
    expect(keys).toContain("error.invalid");
    expect(keys).toContain("helper.title");
    expect(keys.size).toBeGreaterThan(100);
    expect([...keys].filter((key) => !requiredUiKeys.includes(key))).toEqual(
      [],
    );
    const missing = [...packs].flatMap(([code, pack]) =>
      [...keys]
        .filter((key) => !pack.ui[key]?.trim())
        .map((key) => `${code}: ${key}`),
    );
    expect(missing).toEqual([]);
  });
  for (const code of ["en", "am", "om"]) {
    it(`${code} contains usable rules, sourced FAQ, and diverse evaluation cases`, () => {
      const pack = packs.get(code)!;
      expect(
        (pack.prompts.escalation as string[]).length,
      ).toBeGreaterThanOrEqual(5);
      expect((pack.prompts.distress as string[]).length).toBeGreaterThanOrEqual(
        5,
      );
      expect(
        (pack.prompts.small_talk as string[]).length,
      ).toBeGreaterThanOrEqual(5);
      expect(pack.prompts.system_addendum).toMatch(/passages/);
      expect(pack.prompts.system_addendum).toMatch(
        /medical, legal or financial/,
      );
      const checks = pack.checks as {
        id: string;
        question: string;
        expect: string;
        expect_passages?: string[];
        notes?: string;
      }[];
      expect(checks.length).toBeGreaterThanOrEqual(13);
      expect(new Set(checks.map(({ id }) => id)).size).toBe(checks.length);
      for (const kind of ["answer", "notfound", "escalation", "distress"]) {
        expect(checks.some(({ expect: expected }) => expected === kind)).toBe(
          true,
        );
      }
      const faqs = pack.faq as { q: string; a: string; source: string }[];
      expect(faqs.length).toBeGreaterThanOrEqual(6);
      for (const faq of faqs) {
        expect(faq.q.trim()).not.toBe("");
        expect(faq.a.trim()).not.toBe("");
        expect(passages.some(({ id }) => id === faq.source)).toBe(true);
      }
      for (const check of checks.filter(
        ({ expect: expected, notes }) =>
          expected === "answer" && !notes?.includes("job"),
      )) {
        for (const id of check.expect_passages ?? [])
          expect(passages.some((passage) => passage.id === id)).toBe(true);
      }
      expect(pack.ui["help.offer"]).toBeTruthy();
      expect(pack.ui["distress.message"]).toBeTruthy();
      expect(pack.meta.reviewed_by).toBeNull();
      expect(pack.meta.reviewed_on).toBeNull();
      expect(pack.meta.status).not.toBe("live");
      expect(pack.voice.engine).toBeNull();
      expect(pack.voice.bcp_tag).toBeNull();
    });
  }

  it("replaces scaffold English with distinct draft UI translations and retains ICU variables", () => {
    const en = packs.get("en")!;
    for (const code of ["am", "om"]) {
      const pack = packs.get(code)!;
      for (const key of [
        "welcome.title",
        "help.button",
        "composer.label",
        "voice.permissionDenied",
        "helper.title",
      ]) {
        expect(pack.ui[key]).not.toBe(en.ui[key]);
      }
      expect(pack.ui["review.heard"]).toContain("{text}");
      expect(pack.ui["answer.source"]).toContain("{lesson}");
      expect(pack.ui["message.count"]).toContain("plural");
    }
  });

  it("stores display spelling separately from search-variant evaluation questions", () => {
    const amChecks = JSON.stringify(packs.get("am")!.checks);
    const omChecks = JSON.stringify(packs.get("om")!.checks);
    expect(amChecks).toContain("ሥራ");
    expect(amChecks).toContain("ስራ");
    expect(omChecks).toContain("waa'ee");
    expect(omChecks).toContain("waa’ee");
    for (const file of ["ui", "prompts", "glossary", "sms", "faq"]) {
      expect(
        readFileSync(path.join(root, `locales/om/${file}.yaml`), "utf8"),
      ).not.toMatch(/[‘’ʼ]/);
    }
    expect(packs.get("am")!.ui["month.3"]).toBe("ህዳር");
  });

  it("keeps draft glossary definitions in the language of their pack", () => {
    const english = packs.get("en")!.glossary as {
      id: string;
      simple_definition: string;
    }[];
    for (const code of ["am", "om"]) {
      const glossary = packs.get(code)!.glossary as {
        id: string;
        simple_definition: string;
      }[];
      for (const entry of glossary) {
        expect(entry.simple_definition, `${code}: ${entry.id}`).not.toBe(
          english.find(({ id }) => id === entry.id)?.simple_definition,
        );
        if (code === "am")
          expect(entry.simple_definition).toMatch(/\p{Script=Ethiopic}/u);
      }
    }
  });
});
