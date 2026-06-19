import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync as defaultExecFileSync } from "node:child_process";

/**
 * Next.js App Router framework files that don't require co-located tests
 * (they contain no application logic, only framework conventions).
 */
export const NEXTJS_ROUTER_BOILERPLATE_NAMES = [
  "layout", "loading", "error", "not-found", "template", "default",
  "global-error", "sitemap", "robots", "manifest", "route",
];

/**
 * Given a list of newly-added paths and a `pathExists` probe, returns the
 * source paths that have no co-located test file. Pure.
 *
 * @param {string[]} addedPaths
 * @param {(relativePath: string) => boolean} pathExists
 * @param {{ srcRoot?: string, exemptFiles?: string[], exemptPaths?: string[], routerBoilerplateNames?: string[] }} opts
 */
export function findNewSourceWithoutTest(addedPaths, pathExists, {
  srcRoot = "src/",
  exemptFiles = [],
  exemptPaths = ["types", "test"],
  routerBoilerplateNames = NEXTJS_ROUTER_BOILERPLATE_NAMES,
} = {}) {
  const srcRootRe = new RegExp(`^${srcRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.+\\.(?:tsx?|jsx?|mjs)$`);
  const testRe = /\.(?:test|spec)\.(?:tsx?|jsx?|mjs)$/;
  const typeDeclRe = /\.d\.ts$/;
  const storyRe = /\.stories\.(?:tsx?|jsx?)$/;
  const exemptPathRe = exemptPaths.length > 0
    ? new RegExp(`^${srcRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(${exemptPaths.join("|")})\\/`)
    : null;
  const boilerplateRe = routerBoilerplateNames.length > 0
    ? new RegExp(`(^|\\/)(?:${routerBoilerplateNames.join("|")})\\.(?:tsx?|jsx?)$`)
    : null;
  const exemptFileSet = new Set(exemptFiles);

  const addedSet = new Set(addedPaths);
  const offenders = [];

  for (const file of addedPaths) {
    if (!srcRootRe.test(file)) continue;
    if (testRe.test(file)) continue;
    if (typeDeclRe.test(file)) continue;
    if (storyRe.test(file)) continue;
    if (exemptPathRe && exemptPathRe.test(file)) continue;
    if (boilerplateRe && boilerplateRe.test(file)) continue;
    if (exemptFileSet.has(file)) continue;

    const base = file.replace(/\.(tsx?|jsx?|mjs)$/, "");
    const ext = file.match(/\.(tsx?|jsx?|mjs)$/)[1];
    const candidates = [
      `${base}.test.${ext}`,
      `${base}.spec.${ext}`,
      ...(ext === "tsx" ? [`${base}.test.ts`, `${base}.spec.ts`] : []),
    ];

    const found = candidates.some((c) => addedSet.has(c) || pathExists(c));
    if (!found) offenders.push(file);
  }

  return offenders;
}

/**
 * Creates a pre-commit step that requires newly added source files to ship
 * with a co-located test file.
 *
 * @param {{ srcRoot?: string, exemptFiles?: string[], exemptPaths?: string[], routerBoilerplateNames?: string[] }} opts
 */
export function createNewSourceNeedsTestStep({
  srcRoot = "src/",
  exemptFiles = [],
  exemptPaths = ["types", "test"],
  routerBoilerplateNames = NEXTJS_ROUTER_BOILERPLATE_NAMES,
} = {}) {
  return {
    label: "new-source-needs-test",
    fn(context) {
      const {
        repoRoot = process.cwd(),
        fs = { existsSync },
        execFileSync = defaultExecFileSync,
        env = process.env,
      } = context;

      if (env.SKIP_TEST_REQUIRED === "1") return;

      const nameStatus = execFileSync(
        "git",
        ["diff", "--cached", "--name-status", "--diff-filter=A", "-M"],
        { encoding: "utf8" },
      );

      const added = [];
      for (const line of nameStatus.split("\n")) {
        if (!line) continue;
        const parts = line.split("\t");
        if (parts[0] === "A" && parts[1]) added.push(parts[1]);
      }
      if (added.length === 0) return;

      const offenders = findNewSourceWithoutTest(
        added,
        (rel) => fs.existsSync(join(repoRoot, rel)),
        { srcRoot, exemptFiles, exemptPaths, routerBoilerplateNames },
      );

      if (offenders.length > 0) {
        throw new Error(
          `New source file(s) added without a co-located test:\n\n` +
            offenders.map((f) => `  ${f}`).join("\n") +
            `\n\nAdd a *.test.* file next to each source file (TDD: write the test first).\n` +
            `If a test genuinely doesn't apply, set SKIP_TEST_REQUIRED=1 to bypass with intent.`,
        );
      }
    },
  };
}
