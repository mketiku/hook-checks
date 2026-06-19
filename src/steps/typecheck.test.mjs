import { describe, it, expect, vi } from "vitest";
import { typecheckStep } from "./typecheck.mjs";

describe("typecheckStep", () => {
  it("skips when no TS/config files changed", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    typecheckStep.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["supabase/migrations/1.sql", "docs/readme.md"],
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("skipping typecheck"));
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("runs typecheck when .ts files changed", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    typecheckStep.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["src/lib/util.ts"],
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "typecheck"],
      expect.objectContaining({ cwd: "/root" }),
    );
  });

  it("runs typecheck when .tsx files changed", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    typecheckStep.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["src/components/Foo.tsx"],
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "typecheck"],
      expect.anything(),
    );
  });

  it("runs typecheck when JSON files changed (affects types)", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    typecheckStep.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["package.json"],
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "typecheck"],
      expect.anything(),
    );
  });

  it("runs typecheck when tsconfig changes", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    typecheckStep.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["tsconfig.json"],
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "typecheck"],
      expect.anything(),
    );
  });

  it("runs typecheck when changedFiles is null (cannot determine base)", () => {
    const execFileSync = vi.fn();
    const stdout = { write: vi.fn() };
    typecheckStep.fn({
      execFileSync,
      pushBase: null,
      changedFiles: null,
      repoRoot: "/root",
      env: {},
      stdout,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "typecheck"],
      expect.objectContaining({ cwd: "/root" }),
    );
  });

  it("has label 'typecheck'", () => {
    expect(typecheckStep.label).toBe("typecheck");
  });
});
