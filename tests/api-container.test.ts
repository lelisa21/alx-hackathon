import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("P07 runtime packaging includes the API's transitive workspace dependency closure", () => {
  const packages = new Map<
    string,
    { directory: string; dependencies: Record<string, string> }
  >();
  for (const entry of readdirSync(resolve("packages"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const directory = `packages/${entry.name}`;
    const manifest = JSON.parse(
      readFileSync(resolve(directory, "package.json"), "utf8"),
    ) as { name: string; dependencies?: Record<string, string> };
    packages.set(manifest.name, {
      directory,
      dependencies: manifest.dependencies ?? {},
    });
  }
  const required = new Set<string>();
  const visit = (name: string) => {
    if (required.has(name)) return;
    required.add(name);
    const manifest = packages.get(name);
    expect(manifest, `Workspace dependency ${name} exists`).toBeDefined();
    for (const [dependency, version] of Object.entries(manifest!.dependencies))
      if (version.startsWith("workspace:")) visit(dependency);
  };
  visit("@dimts/api");
  const stage = readFileSync(resolve("Dockerfile"), "utf8")
    .split(/(?=^FROM )/mu)
    .find((section) => /^FROM[^\n]+ AS api\r?$/mu.test(section));
  expect(stage, "An API runtime stage exists").toBeDefined();
  const copies = [
    ...stage!.matchAll(/^COPY --from=workspace \/app\/(\S+) (\S+)\r?$/gmu),
  ].map((match) => ({ source: match[1]!, destination: match[2]! }));
  const missing: string[] = [];
  for (const name of required)
    for (const artifact of ["package.json", "dist"]) {
      const file = `${packages.get(name)!.directory}/${artifact}`;
      if (
        !copies.some(
          ({ source, destination }) =>
            source === destination &&
            (source === file || file.startsWith(`${source}/`)),
        )
      )
        missing.push(file);
    }
  expect(
    missing,
    "The runtime image must include manifests and built code for every workspace runtime dependency",
  ).toEqual([]);
});
