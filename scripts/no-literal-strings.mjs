import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const widgetSource = path.resolve("packages/widget/src");
const userFacingAttributes =
  /\b(?:aria-label|alt|placeholder|title)\s*=\s*(["'])(.*?)\1/gs;
const visibleText = />([^<>]+)</gs;
const dynamicMarker = "__DIMTS_DYNAMIC__";
const violations = [];

async function sourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(entryPath)));
    } else if (/\.(?:ts|tsx|html)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function checkMarkup(markup, file) {
  for (const match of markup.matchAll(userFacingAttributes)) {
    if (/[A-Za-z\u0080-\uFFFF]/.test(match[2].replaceAll(dynamicMarker, ""))) {
      violations.push(
        `${file}: literal user-facing ${match[0].split("=")[0].trim()} attribute`,
      );
    }
  }

  for (const match of markup.matchAll(visibleText)) {
    const text = match[1].replaceAll(dynamicMarker, "").trim();
    if (/[A-Za-z\u0080-\uFFFF]/.test(text)) {
      violations.push(`${file}: literal user-facing text "${text}"`);
    }
  }
}

for (const file of await sourceFiles(widgetSource)) {
  const contents = await readFile(file, "utf8");
  if (file.endsWith(".html")) {
    checkMarkup(contents, path.relative(process.cwd(), file));
    continue;
  }

  const source = ts.createSourceFile(
    file,
    contents,
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    if (
      ts.isTaggedTemplateExpression(node) &&
      (node.tag.getText(source) === "html" ||
        node.tag.getText(source).endsWith(".html"))
    ) {
      const template = node.template;
      const parts = ts.isNoSubstitutionTemplateLiteral(template)
        ? [template.text]
        : [
            template.head.text,
            ...template.templateSpans.map((span) => span.literal.text),
          ];
      checkMarkup(
        parts.join(dynamicMarker),
        path.relative(process.cwd(), file),
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (violations.length > 0) {
  console.error("User-facing widget text must come from locale keys:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}
