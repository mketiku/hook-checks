import { describe, it, expect, vi } from "vitest";
import { createCoverageStep } from "./coverage.mjs";

describe("createCoverageStep", () => {
  it("returns a step with label 'coverage'", () => {
    expect(createCoverageStep().label).toBe("coverage");
  });

  it("skips when no files under srcRoot changed", () => {
    const step = createCoverageStep({ srcRoot: "src/" });
    const execFileSync = vi.fn();
    step.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["docs/x.md"],
      repoRoot: "/root",
      env: {},
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
    });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("runs vitest and coverage:diff when src/ files changed", () => {
    const step = createCoverageStep({ srcRoot: "src/" });
    const execFileSync = vi.fn()
      .mockReturnValueOnce(undefined) // mkdir
      .mockReturnValueOnce("Test Files  1 passed\nTests  3 passed") // vitest
      .mockReturnValueOnce(undefined); // coverage:diff
    const stdout = { write: vi.fn() };
    step.fn({
      execFileSync,
      pushBase: "base-sha",
      changedFiles: ["src/foo.tsx"],
      repoRoot: "/root",
      env: {},
      stdout,
      stderr: { write: vi.fn() },
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bunx",
      ["vitest", "run", "--changed=base-sha", "--coverage"],
      expect.objectContaining({ cwd: "/root" }),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "coverage:diff"],
      expect.objectContaining({ cwd: "/root" }),
    );
  });

  it("respects custom coverageDiffScript", () => {
    const step = createCoverageStep({ srcRoot: "src/", coverageDiffScript: "my:diff" });
    const execFileSync = vi.fn()
      .mockReturnValueOnce(undefined) // mkdir
      .mockReturnValueOnce("") // vitest
      .mockReturnValueOnce(undefined); // custom diff script
    step.fn({
      execFileSync,
      pushBase: "sha",
      changedFiles: ["src/x.ts"],
      repoRoot: "/root",
      env: {},
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
    });
    expect(execFileSync).toHaveBeenCalledWith("bun", ["run", "my:diff"], expect.anything());
  });

  it("runs when srcRoot is null regardless of changed files", () => {
    const step = createCoverageStep({ srcRoot: null });
    const execFileSync = vi.fn()
      .mockReturnValueOnce(undefined) // mkdir
      .mockReturnValueOnce("") // vitest
      .mockReturnValueOnce(undefined); // coverage:diff
    step.fn({
      execFileSync,
      pushBase: "sha",
      changedFiles: ["docs/readme.md"],
      repoRoot: "/root",
      env: {},
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
    });
    expect(execFileSync).toHaveBeenCalledWith("bunx", expect.arrayContaining(["vitest"]), expect.anything());
  });

  it("falls back to origin/main when pushBase is null", () => {
    const step = createCoverageStep();
    const execFileSync = vi.fn()
      .mockReturnValueOnce(undefined) // mkdir
      .mockReturnValueOnce("") // vitest
      .mockReturnValueOnce(undefined); // coverage:diff
    step.fn({
      execFileSync,
      pushBase: null,
      changedFiles: ["src/x.ts"],
      repoRoot: "/root",
      env: {},
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "bunx",
      ["vitest", "run", "--changed=origin/main", "--coverage"],
      expect.anything(),
    );
  });

  it("writes failure output and rethrows when vitest fails", () => {
    const step = createCoverageStep();
    const err = new Error("vitest error");
    err.stdout = "some output";
    err.stderr = "";
    const execFileSync = vi.fn()
      .mockReturnValueOnce(undefined) // mkdir
      .mockImplementationOnce(() => { throw err; }); // vitest
    const stderr = { write: vi.fn() };
    expect(() =>
      step.fn({
        execFileSync,
        pushBase: "sha",
        changedFiles: ["src/x.ts"],
        repoRoot: "/root",
        env: {},
        stdout: { write: vi.fn() },
        stderr,
      }),
    ).toThrow("coverage failed");
    expect(stderr.write).toHaveBeenCalledWith("✖ coverage failed\n");
  });
});
