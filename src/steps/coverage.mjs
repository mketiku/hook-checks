import { execFileSync as defaultExecFileSync } from "node:child_process";
import { join } from "node:path";
import { getPushMetadata, tail, extractVitestFailures } from "../utils.mjs";

/**
 * Creates a pre-push coverage step.
 *
 * @param {object} opts
 * @param {string|null} [opts.srcRoot="src/"] - Only run when files under this
 *   prefix changed. Pass null to always run (use `codeFilter` for custom logic).
 * @param {((f: string) => boolean)|null} [opts.codeFilter] - Overrides
 *   `srcRoot` when provided; coverage runs only when at least one changed file
 *   passes this predicate. Useful when coverage should trigger on multiple
 *   roots (e.g. `src/` OR `scripts/`).
 * @param {string} [opts.coverageDiffScript="coverage:diff"] - npm script to
 *   run after vitest for patch-coverage diff output.
 */
export function createCoverageStep({
  srcRoot = "src/",
  codeFilter = null,
  coverageDiffScript = "coverage:diff",
} = {}) {
  return {
    label: "coverage",
    fn(context) {
      const {
        repoRoot = process.cwd(),
        execFileSync = defaultExecFileSync,
        env = process.env,
        stdout = process.stdout,
        stderr = process.stderr,
      } = context;
      const { pushBase, changedFiles } = getPushMetadata(context, execFileSync);

      const shouldRun = codeFilter
        ? (f) => codeFilter(f)
        : srcRoot
          ? (f) => f.startsWith(srcRoot)
          : () => true;
      if (changedFiles && !changedFiles.some(shouldRun)) return;

      // Local hook runs only the changed-files subset for speed; the full
      // suite + whole-repo thresholds are the authoritative gate in CI.
      // Thresholds are disabled here (a partial run can't meet global numbers)
      // — the patch-coverage diff below is the local signal for new code.
      // Capture output to avoid SIGPIPE when git's stdout pipe closes
      // before vitest finishes writing the coverage table.
      let coverageOutput = "";
      try {
        execFileSync("mkdir", ["-p", join(repoRoot, "coverage/.tmp")], {
          cwd: repoRoot,
          env,
        });
        coverageOutput = execFileSync(
          "bunx",
          ["vitest", "run", `--changed=${pushBase ?? "origin/main"}`, "--coverage"],
          {
            cwd: repoRoot,
            encoding: "utf8",
            env: { ...env, VITEST_COVERAGE: "1", SKIP_COVERAGE_THRESHOLDS: "1" },
            maxBuffer: 16 * 1024 * 1024,
          },
        ) ?? "";
      } catch (err) {
        const out = (err.stdout ?? "") + (err.stderr ?? "");
        stderr.write(`✖ coverage failed\n`);
        const signal = extractVitestFailures(out);
        const outLines = out.split(/\r?\n/);
        const fallback = outLines.length <= 40 ? out.trim() || err.message : tail(out || err.message);
        stderr.write(`${signal || fallback}\n`);
        throw new Error("coverage failed");
      }

      const summaryLines = (coverageOutput.match(/^\s*(Test Files|Tests)\s.+$/gm) ?? []).map((l) => l.trim());
      if (summaryLines.length > 0) stdout.write(`${summaryLines.join("\n")}\n`);

      execFileSync("bun", ["run", coverageDiffScript], {
        cwd: repoRoot,
        stdio: "inherit",
        env: { ...env, DIFF_BASE: pushBase ?? "origin/main" },
      });
    },
  };
}
