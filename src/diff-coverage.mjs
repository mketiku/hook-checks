#!/usr/bin/env node
// Patch-coverage gate. Reads vitest's v8 coverage-final.json, intersects
// each file's covered statements with the lines changed vs the base ref,
// and fails when patch coverage falls below the threshold.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

/**
 * Parse `git diff --unified=0` output into a Map<file, Set<lineNumber>>
 * of added/modified line numbers on the new-file side. Pure.
 */
export function parseDiffLines(diffText) {
  const byFile = new Map();
  let currentFile = null;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      if (path === "/dev/null") {
        currentFile = null;
      } else {
        currentFile = path.startsWith("b/") ? path.slice(2) : path;
        if (!byFile.has(currentFile)) byFile.set(currentFile, new Set());
      }
      continue;
    }
    if (!currentFile) continue;
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      const start = Number(hunk[1]);
      const len = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < len; i++) byFile.get(currentFile).add(start + i);
    }
  }

  return byFile;
}

/**
 * Given { file → Set<line> } and v8 coverage-final.json data, compute
 * patch coverage per file and overall. Pure.
 *
 * @param {{ changedLinesByFile: Map, coverageData: object, repoRoot: string, filter?: (file: string) => boolean }} opts
 */
export function computePatchCoverage({
  changedLinesByFile,
  coverageData,
  repoRoot,
  filter = () => true,
}) {
  const perFile = [];
  let hit = 0;
  let total = 0;

  for (const [file, lines] of changedLinesByFile.entries()) {
    if (!filter(file)) continue;
    if (lines.size === 0) continue;

    const absPath = resolve(repoRoot, file);
    const fileCoverage = coverageData[absPath];

    if (!fileCoverage) {
      perFile.push({ file, hit: 0, total: lines.size, missing: true });
      total += lines.size;
      continue;
    }

    const { statementMap, s } = fileCoverage;
    let fileHit = 0;
    let fileTotal = 0;

    for (const [id, loc] of Object.entries(statementMap)) {
      if (!loc?.start) continue;
      if (!lines.has(loc.start.line)) continue;
      fileTotal += 1;
      if ((s[id] ?? 0) > 0) fileHit += 1;
    }

    if (fileTotal === 0) continue;
    perFile.push({ file, hit: fileHit, total: fileTotal, missing: false });
    hit += fileHit;
    total += fileTotal;
  }

  return {
    hit,
    total,
    percentage: total === 0 ? 100 : (hit / total) * 100,
    perFile,
  };
}

/**
 * Build the markdown comment posted to the PR. Pure.
 *
 * @param {{ result: object, threshold: number, base: string, commentMarker?: string }} opts
 */
export function renderMarkdownSummary({ result, threshold, base, commentMarker = "patch-coverage" }) {
  const lines = [];
  lines.push(`<!-- ${commentMarker} -->`);
  lines.push("### Patch coverage");

  if (result.total === 0 && result.perFile.length === 0) {
    lines.push(`_No covered source lines changed vs \`${base}\` — gate skipped._`);
    return lines.join("\n");
  }

  const missing = result.perFile.filter((r) => r.missing);
  const covered = result.perFile.filter((r) => !r.missing);
  const belowThreshold = covered.filter(
    (r) => r.total > 0 && (r.hit / r.total) * 100 < threshold,
  );

  const status = missing.length === 0 && result.percentage >= threshold ? "✅" : "❌";
  lines.push(
    `${status} **${result.percentage.toFixed(2)}%** patched (${result.hit}/${result.total} statements) — threshold **${threshold}%** vs \`${base}\`.`,
  );

  if (missing.length > 0) {
    lines.push("");
    lines.push(`**No test imports these new/changed files** (TDD signal — add at least one test that imports each):`);
    for (const row of missing) {
      lines.push(`- \`${row.file}\` (${row.total} touched lines, untested)`);
    }
  }

  if (belowThreshold.length > 0) {
    lines.push("");
    lines.push(`**Below ${threshold}% on touched lines:**`);
    for (const row of belowThreshold) {
      const pct = (row.hit / row.total) * 100;
      lines.push(`- \`${row.file}\` — ${pct.toFixed(0)}% (${row.hit}/${row.total})`);
    }
  }

  if (covered.length > 0 && missing.length === 0 && belowThreshold.length === 0) {
    lines.push("");
    lines.push("All touched files clear the threshold.");
  }

  return lines.join("\n");
}

/**
 * Run the diff-coverage gate. Call from a thin repo-specific wrapper that
 * provides the `filter` function.
 *
 * @param {{ filter?: (file: string) => boolean, commentMarker?: string, repoRoot?: string, env?: object }} opts
 */
export function runDiffCoverage({
  filter = () => true,
  commentMarker = "patch-coverage",
  repoRoot = process.cwd(),
  env = process.env,
} = {}) {
  const threshold = Number(env.PATCH_COVERAGE_THRESHOLD ?? "80");
  const base = env.DIFF_BASE || "origin/main";
  const coveragePath = join(repoRoot, "coverage/coverage-final.json");

  if (!existsSync(coveragePath)) {
    console.error(`coverage-final.json not found at ${coveragePath}. Run your coverage script first.`);
    process.exit(1);
  }

  let diffText;
  try {
    diffText = execFileSync(
      "git",
      ["diff", "--unified=0", `${base}...HEAD`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    console.error(`Failed to run git diff against ${base}: ${err.message}`);
    process.exit(1);
  }

  const changedLinesByFile = parseDiffLines(diffText);
  const coverageData = JSON.parse(readFileSync(coveragePath, "utf8"));

  const result = computePatchCoverage({ changedLinesByFile, coverageData, repoRoot, filter });

  const summaryPath = join(repoRoot, "coverage/patch-coverage.md");
  writeFileSync(summaryPath, renderMarkdownSummary({ result, threshold, base, commentMarker }));

  if (result.total === 0 && result.perFile.length === 0) {
    console.log("No covered source lines changed — patch coverage gate skipped.");
    return;
  }

  console.log(`Patch coverage vs ${base}: ${result.percentage.toFixed(2)}% (${result.hit}/${result.total})`);
  for (const row of result.perFile) {
    const pct = row.total === 0 ? 100 : (row.hit / row.total) * 100;
    const flag = row.missing ? " — NO TEST IMPORTS THIS FILE" : "";
    console.log(`  ${row.file}: ${pct.toFixed(0)}% (${row.hit}/${row.total})${flag}`);
  }

  const missing = result.perFile.filter((r) => r.missing);
  if (missing.length > 0) {
    console.error(
      `\n✖ ${missing.length} new/changed file(s) have no test importing them:\n` +
        missing.map((r) => `   ${r.file}`).join("\n") +
        `\n\nThis is the canonical "shipped untested code" signal. Add a test file that imports each of these.`,
    );
    process.exit(1);
  }

  if (result.percentage < threshold) {
    console.error(
      `\n✖ Patch coverage ${result.percentage.toFixed(2)}% is below threshold ${threshold}%.\n` +
        `Add tests for the changed lines, or raise/override PATCH_COVERAGE_THRESHOLD with justification.`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && __filename === process.argv[1]) {
  runDiffCoverage();
}
