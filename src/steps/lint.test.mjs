import { describe, it, expect, vi } from "vitest";
import { lintStep } from "./lint.mjs";

describe("lintStep", () => {
  it("skips when no JS/TS files changed", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    lintStep.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["supabase/migrations/1.sql", "docs/readme.md"],
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("skipping lint"));
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("runs lint when .tsx files changed", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    lintStep.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["src/components/Foo.tsx"],
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "lint"],
      expect.objectContaining({ cwd: "/root" }),
    );
  });

  it("runs lint when .mjs files changed", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    lintStep.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["scripts/foo.mjs"],
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "lint"],
      expect.anything(),
    );
  });

  it("runs lint when changedFiles is null (cannot determine base)", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    lintStep.fn({
      execFileSync,
      pushBase: null,
      changedFiles: null,
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "lint"],
      expect.objectContaining({ cwd: "/root" }),
    );
  });

  it("has label 'lint'", () => {
    expect(lintStep.label).toBe("lint");
  });
});
