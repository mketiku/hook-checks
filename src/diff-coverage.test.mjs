import { describe, it, expect } from "vitest";
import { parseDiffLines, computePatchCoverage, renderMarkdownSummary } from "./diff-coverage.mjs";

describe("parseDiffLines", () => {
  it("extracts changed line numbers per file from unified=0 diff", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -10,0 +11,2 @@",
      "+const a = 1;",
      "+const b = 2;",
      "@@ -20,1 +22,1 @@",
      "-old",
      "+new",
    ].join("\n");

    const result = parseDiffLines(diff);
    expect([...result.get("src/foo.ts")]).toEqual([11, 12, 22]);
  });

  it("handles single-line hunk (no length suffix)", () => {
    const diff = ["+++ b/src/bar.ts", "@@ -5 +5 @@", "-old", "+new"].join("\n");
    expect([...parseDiffLines(diff).get("src/bar.ts")]).toEqual([5]);
  });

  it("ignores deleted files (+++ /dev/null)", () => {
    const diff = ["+++ /dev/null", "@@ -1,2 +0,0 @@", "-gone", "-gone too"].join("\n");
    expect(parseDiffLines(diff).size).toBe(0);
  });

  it("returns empty map for empty diff", () => {
    expect(parseDiffLines("").size).toBe(0);
  });

  it("tracks multiple files in one diff", () => {
    const diff = [
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "+x",
      "+++ b/src/b.ts",
      "@@ -2 +2 @@",
      "+y",
    ].join("\n");
    const result = parseDiffLines(diff);
    expect([...result.get("src/a.ts")]).toEqual([1]);
    expect([...result.get("src/b.ts")]).toEqual([2]);
  });
});

describe("computePatchCoverage", () => {
  const repoRoot = "/repo";

  const makeCoverage = (file, stmts) => ({
    [`/repo/${file}`]: {
      path: `/repo/${file}`,
      statementMap: Object.fromEntries(
        stmts.map((s, i) => [String(i), { start: { line: s.line }, end: { line: s.line } }]),
      ),
      s: Object.fromEntries(stmts.map((s, i) => [String(i), s.hits])),
    },
  });

  it("counts hit vs missed statements on changed lines only", () => {
    const changedLinesByFile = new Map([["src/foo.ts", new Set([10, 11, 20])]]);
    const coverageData = makeCoverage("src/foo.ts", [
      { line: 10, hits: 5 },
      { line: 11, hits: 0 },
      { line: 20, hits: 3 },
      { line: 99, hits: 0 },
    ]);
    const result = computePatchCoverage({ changedLinesByFile, coverageData, repoRoot });
    expect(result.hit).toBe(2);
    expect(result.total).toBe(3);
    expect(result.percentage).toBeCloseTo(66.67, 1);
  });

  it("flags files missing from coverage report (new file never imported)", () => {
    const changedLinesByFile = new Map([["src/orphan.ts", new Set([1, 2, 3])]]);
    const result = computePatchCoverage({ changedLinesByFile, coverageData: {}, repoRoot });
    expect(result.perFile[0]).toMatchObject({ file: "src/orphan.ts", missing: true, hit: 0, total: 3 });
    expect(result.percentage).toBe(0);
  });

  it("returns 100% when no covered statements fall on changed lines", () => {
    const changedLinesByFile = new Map([["src/foo.ts", new Set([50])]]);
    const coverageData = makeCoverage("src/foo.ts", [{ line: 10, hits: 1 }]);
    const result = computePatchCoverage({ changedLinesByFile, coverageData, repoRoot });
    expect(result.total).toBe(0);
    expect(result.percentage).toBe(100);
  });

  it("honors the filter to exclude paths", () => {
    const changedLinesByFile = new Map([
      ["src/foo.test.ts", new Set([1])],
      ["src/foo.ts", new Set([1])],
    ]);
    const coverageData = makeCoverage("src/foo.ts", [{ line: 1, hits: 1 }]);
    const result = computePatchCoverage({
      changedLinesByFile,
      coverageData,
      repoRoot,
      filter: (f) => !f.endsWith(".test.ts"),
    });
    expect(result.perFile.map((r) => r.file)).toEqual(["src/foo.ts"]);
    expect(result.percentage).toBe(100);
  });

  it("aggregates across multiple files", () => {
    const changedLinesByFile = new Map([
      ["src/a.ts", new Set([1])],
      ["src/b.ts", new Set([1, 2])],
    ]);
    const coverageData = {
      ...makeCoverage("src/a.ts", [{ line: 1, hits: 1 }]),
      ...makeCoverage("src/b.ts", [{ line: 1, hits: 0 }, { line: 2, hits: 0 }]),
    };
    const result = computePatchCoverage({ changedLinesByFile, coverageData, repoRoot });
    expect(result.hit).toBe(1);
    expect(result.total).toBe(3);
  });
});

describe("renderMarkdownSummary", () => {
  const base = "origin/main";

  it("flags untested new files distinctly from low-coverage files", () => {
    const result = {
      hit: 5,
      total: 10,
      percentage: 50,
      perFile: [
        { file: "src/new.ts", hit: 0, total: 4, missing: true },
        { file: "src/changed.ts", hit: 3, total: 6, missing: false },
      ],
    };
    const md = renderMarkdownSummary({ result, threshold: 80, base });
    expect(md).toContain("<!-- patch-coverage -->");
    expect(md).toContain("❌");
    expect(md).toContain("No test imports these new/changed files");
    expect(md).toContain("`src/new.ts` (4 touched lines, untested)");
    expect(md).toContain("Below 80% on touched lines");
    expect(md).toContain("`src/changed.ts` — 50% (3/6)");
  });

  it("accepts a custom commentMarker", () => {
    const result = { hit: 0, total: 0, percentage: 100, perFile: [] };
    const md = renderMarkdownSummary({ result, threshold: 80, base, commentMarker: "my-project-coverage" });
    expect(md).toContain("<!-- my-project-coverage -->");
  });

  it("reports success when threshold met and no missing files", () => {
    const result = {
      hit: 9,
      total: 10,
      percentage: 90,
      perFile: [{ file: "src/foo.ts", hit: 9, total: 10, missing: false }],
    };
    const md = renderMarkdownSummary({ result, threshold: 80, base });
    expect(md).toContain("✅");
    expect(md).toContain("All touched files clear the threshold");
    expect(md).not.toContain("Below ");
    expect(md).not.toContain("No test imports");
  });

  it("emits a skipped message when nothing relevant changed", () => {
    const result = { hit: 0, total: 0, percentage: 100, perFile: [] };
    const md = renderMarkdownSummary({ result, threshold: 80, base });
    expect(md).toContain("gate skipped");
    expect(md).not.toContain("❌");
  });
});
