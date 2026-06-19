import { execFileSync as defaultExecFileSync } from "node:child_process";
import { getPushMetadata } from "../utils.mjs";

// App Router special files + next.config + middleware are the only places
// where `next build` enforces invariants that tsc/eslint/vitest cannot see
// (e.g. a route segment config rejected under nextConfig.cacheComponents).
const NEXT_SPECIAL_FILES = new Set([
  "route", "page", "layout", "template", "default",
  "error", "global-error", "not-found", "loading",
  "sitemap", "robots", "manifest",
  "opengraph-image", "twitter-image", "icon", "apple-icon",
]);

/**
 * Returns true if any changed file can affect Next.js build output in ways
 * that tsc/lint/tests cannot catch. Pure — no fs or git calls.
 */
export function requiresNextBuild(changedFiles) {
  return changedFiles.some((file) => {
    if (!file) return false;
    if (/(^|\/)next\.config\.(ts|js|mjs|cjs)$/.test(file)) return true;
    if (/(^|\/)(proxy|middleware)\.(ts|js)$/.test(file)) return true;
    if (!/(^|\/)app\//.test(file)) return false;
    const m = file.match(/(?:^|\/)([^/]+)\.(?:tsx?|jsx?|mjs)$/);
    return m ? NEXT_SPECIAL_FILES.has(m[1]) : false;
  });
}

export const nextBuildStep = {
  label: "next-build (route/config changed)",
  fn(context) {
    const {
      repoRoot = process.cwd(),
      execFileSync = defaultExecFileSync,
      env = process.env,
      stdout = process.stdout,
    } = context;
    const { changedFiles } = getPushMetadata(context, execFileSync);
    if (changedFiles && !requiresNextBuild(changedFiles)) {
      stdout.write("  ℹ No route/config changes — skipping next build\n");
      return;
    }
    stdout.write(
      "  Route/config changed — running next build (catches invariants tsc/lint/tests miss)…\n",
    );
    execFileSync("bun", ["run", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
      env,
    });
  },
};
