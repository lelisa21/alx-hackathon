// Render the trilingual course content into static lesson pages.
//
//   node scripts/build-lessons.mjs [content/savanna] [packages/widget/dist/learn]
//
// Citations point at <content base>/<lang>/<lesson>.html#<anchor>. Heading ids come
// from the same markdownOutline() that ingestion uses, so every citation link
// lands on the section the answer was taken from.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markdownOutline } from "../packages/grounding/dist/index.js";
import { loadPacks } from "../packages/locales-tools/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.resolve(root, process.argv[2] ?? "content/savanna");
const outDir = path.resolve(
  root,
  process.argv[3] ?? "packages/widget/dist/learn",
);
const packs = loadPacks(path.join(root, "locales"));

const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function inline(text) {
  return escape(text)
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/gu, "<em>$1</em>")
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu,
      '<a href="$2" rel="noopener">$1</a>',
    );
}

/** Minimal Markdown for authored lessons: headings, paragraphs, lists, quotes. */
function renderMarkdown(markdown, outline, citedLabel) {
  const headings = [...outline];
  const html = [];
  let paragraph = [];
  let list = null;
  let section = false;
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of markdown.split(/\r?\n/u)) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/u.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const entry = headings.shift();
      if (heading[1].length === 1) continue; // The page title renders separately.
      if (section) html.push("</section>");
      section = true;
      html.push(
        `<section class="lesson-section" id="${escape(entry.anchor)}" data-cited="${escape(citedLabel)}" tabindex="-1">`,
        `<h${entry.level}><a class="anchor" href="#${escape(encodeURIComponent(entry.anchor))}" aria-hidden="true">#</a>${inline(entry.title)}</h${entry.level}>`,
      );
      continue;
    }
    const item = /^(?:[-*+]|(\d+)\.)\s+(.*)$/u.exec(line);
    if (item) {
      flushParagraph();
      const tag = item[1] ? "ol" : "ul";
      if (list?.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push(`<li>${inline(item[2])}</li>`);
      continue;
    }
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.replace(/^>\s?/u, ""));
  }
  flushParagraph();
  flushList();
  if (section) html.push("</section>");
  return html.join("\n");
}

const languageNames = (lang) => packs.get(lang)?.meta.name_native ?? lang;
const isReviewed = (lang) => {
  const meta = packs.get(lang)?.meta;
  return Boolean(meta?.reviewed_by && meta?.reviewed_on);
};

function page({ lang, title, description, body, head = "" }) {
  const dir = packs.get(lang)?.meta.dir ?? "ltr";
  return `<!doctype html>
<html lang="${escape(lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Dimts</title>
<meta name="description" content="${escape(description)}">
<link rel="stylesheet" href="/learn/learn.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23164e63'/%3E%3Cpath d='M9 8h7a8 8 0 0 1 0 16H9z' fill='none' stroke='%23fff' stroke-width='3'/%3E%3C/svg%3E">
${head}
</head>
<body>
${body}
<script async src="/dimts-host.js" data-lang="${escape(lang)}"></script>
</body>
</html>
`;
}

function topBar(lang, site, switcher) {
  return `<header class="topbar">
  <a class="brand" href="/" aria-label="${escape(site.home)}"><span class="mark" aria-hidden="true">D</span><span>Dimts</span></a>
  <a class="crumb" href="/learn/${escape(lang)}/">${escape(site.library)}</a>
  <nav class="langs" aria-label="${escape(site.readIn)}">${switcher}</nav>
</header>`;
}

function switcherFor(languages, current, hrefFor) {
  return languages
    .map(
      (lang) =>
        `<a lang="${escape(lang)}" href="${escape(hrefFor(lang))}"${lang === current ? ' aria-current="page"' : ""}>${escape(languageNames(lang))}</a>`,
    )
    .join("");
}

const reviewNotice = (lang, site) =>
  isReviewed(lang)
    ? ""
    : `<p class="notice" role="note">${escape(site.reviewNotice)}</p>`;

async function main() {
  const languages = (await readdir(contentDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b)));
  const lessons = new Map();
  for (const lang of languages) {
    const site = JSON.parse(
      await readFile(path.join(contentDir, lang, "site.json"), "utf8"),
    );
    const files = (await readdir(path.join(contentDir, lang)))
      .filter((name) => name.endsWith(".md"))
      .sort();
    const items = [];
    for (const name of files) {
      const markdown = await readFile(
        path.join(contentDir, lang, name),
        "utf8",
      );
      const outline = markdownOutline(markdown);
      const title = outline.find((entry) => entry.level === 1)?.title ?? name;
      const sections = outline.filter((entry) => entry.level === 2);
      const intro =
        markdown
          .split(/\r?\n/u)
          .find((line) => line.trim() && !line.startsWith("#"))
          ?.trim() ?? "";
      items.push({
        slug: name.replace(/\.md$/u, ""),
        markdown,
        outline,
        title,
        sections,
        intro,
      });
    }
    lessons.set(lang, { site, items });
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "learn.css"),
    await readFile(path.join(root, "scripts", "learn.css"), "utf8"),
  );
  // Static hosting (no nginx envsubst): emit the host loader next to the
  // widget when the public API URL and widget key are provided at build time.
  const publicApi = process.env.DIMTS_PUBLIC_API?.trim();
  const publicKey = process.env.DIMTS_PUBLIC_WIDGET_KEY?.trim();
  if (publicApi && publicKey) {
    const template = await readFile(
      path.join(
        root,
        "packages/widget/public/templates/dimts-host.js.template",
      ),
      "utf8",
    );
    await writeFile(
      path.join(outDir, "..", "dimts-host.js"),
      template
        .replaceAll(
          "${DIMTS_PUBLIC_API}",
          JSON.stringify(publicApi).slice(1, -1),
        )
        .replaceAll(
          "${DIMTS_LOCAL_WIDGET_KEY}",
          JSON.stringify(publicKey).slice(1, -1),
        ),
    );
  }

  for (const [lang, { site, items }] of lessons) {
    await mkdir(path.join(outDir, lang), { recursive: true });
    for (const lesson of items) {
      const available = languages.filter((other) =>
        lessons.get(other)?.items.some(({ slug }) => slug === lesson.slug),
      );
      const toc = lesson.sections
        .map(
          (entry) =>
            `<li><a href="#${escape(encodeURIComponent(entry.anchor))}">${inline(entry.title)}</a></li>`,
        )
        .join("");
      const body = `${topBar(
        lang,
        site,
        switcherFor(
          available,
          lang,
          (other) => `/learn/${other}/${lesson.slug}.html`,
        ),
      )}
<main class="lesson">
  <div class="lesson-head">
    <a class="back" href="/learn/${escape(lang)}/">← ${escape(site.allLessons)}</a>
    <h1>${inline(lesson.title)}</h1>
    ${reviewNotice(lang, site)}
    <button class="ask" type="button" data-dimts-open hidden>${escape(site.askAbout)}</button>
  </div>
  <nav class="toc" aria-labelledby="toc-heading">
    <h2 id="toc-heading">${escape(site.onThisPage)}</h2>
    <ol>${toc}</ol>
  </nav>
  <article class="lesson-body">
${renderMarkdown(lesson.markdown, lesson.outline, site.cited)}
  </article>
</main>`;
      await writeFile(
        path.join(outDir, lang, `${lesson.slug}.html`),
        page({ lang, title: lesson.title, description: lesson.intro, body }),
      );
    }

    const cards = items
      .map(
        (lesson) => `<li class="card">
  <a href="/learn/${escape(lang)}/${escape(lesson.slug)}.html">
    <span class="card-title">${inline(lesson.title)}</span>
    <span class="card-meta">${escape(site.sections.replace("{count}", String(lesson.sections.length)))}</span>
    <span class="card-topics">${lesson.sections
      .slice(0, 3)
      .map((entry) => inline(entry.title))
      .join(" · ")}</span>
  </a>
</li>`,
      )
      .join("\n");
    await writeFile(
      path.join(outDir, lang, "index.html"),
      page({
        lang,
        title: site.library,
        description: site.libraryIntro,
        body: `${topBar(
          lang,
          site,
          switcherFor(languages, lang, (other) => `/learn/${other}/`),
        )}
<main class="library">
  <h1>${escape(site.library)}</h1>
  <p class="lede">${escape(site.libraryIntro)}</p>
  ${reviewNotice(lang, site)}
  <ul class="cards">${cards}</ul>
</main>`,
      }),
    );
  }

  // /learn/ picks the visitor's language when it is available.
  const codes = JSON.stringify(languages);
  await writeFile(
    path.join(outDir, "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dimts · Course library</title>
<meta http-equiv="refresh" content="0; url=/learn/en/">
<script>(()=>{const codes=${codes};const wanted=(navigator.languages||[]).map((l)=>l.toLowerCase().split("-")[0]);const lang=wanted.find((l)=>codes.includes(l))||"en";location.replace("/learn/"+lang+"/");})();</script>
</head><body><a href="/learn/en/">Course library</a></body></html>
`,
  );
  const count = [...lessons.values()].reduce(
    (sum, { items }) => sum + items.length,
    0,
  );
  process.stdout.write(
    `Rendered ${count} lesson pages (${languages.join(", ")}) to ${path.relative(root, outDir)}.\n`,
  );
}

await main();
