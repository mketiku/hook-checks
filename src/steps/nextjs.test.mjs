import { describe, it, expect, vi } from "vitest";
import { requiresNextBuild, nextBuildStep } from "./nextjs.mjs";

describe("requiresNextBuild", () => {
  it("triggers on App Router special files", () => {
    expect(requiresNextBuild(["src/app/reset/route.ts"])).toBe(true);
    expect(requiresNextBuild(["app/(game)/layout.tsx"])).toBe(true);
    expect(requiresNextBuild(["src/app/global-error.tsx"])).toBe(true);
    expect(requiresNextBuild(["src/app/not-found.tsx"])).toBe(true);
    expect(requiresNextBuild(["src/app/loading.tsx"])).toBe(true);
  });

  it("triggers on next.config variants", () => {
    expect(requiresNextBuild(["next.config.ts"])).toBe(true);
    expect(requiresNextBuild(["next.config.js"])).toBe(true);
    expect(requiresNextBuild(["next.config.mjs"])).toBe(true);
  });

  it("triggers on middleware and proxy", () => {
    expect(requiresNextBuild(["src/proxy.ts"])).toBe(true);
    expect(requiresNextBuild(["middleware.ts"])).toBe(true);
  });

  it("does NOT trigger on ordinary components, libs, or tests", () => {
    expect(requiresNextBuild(["src/components/Board.tsx"])).toBe(false);
    expect(requiresNextBuild(["src/lib/util.ts"])).toBe(false);
    expect(requiresNextBuild(["src/app/reset/route.test.ts"])).toBe(false);
    expect(requiresNextBuild(["README.md"])).toBe(false);
    expect(requiresNextBuild([])).toBe(false);
  });
});

describe("nextBuildStep", () => {
  it("has label 'next-build (route/config changed)'", () => {
    expect(nextBuildStep.label).toBe("next-build (route/config changed)");
  });

  it("skips and writes info when no route/config files changed", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("src/components/Foo.tsx");
    const stdout = { write: vi.fn() };
    nextBuildStep.fn({ execFileSync, stdout, repoRoot: "/root", env: {} });
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("skipping next build"));
    expect(execFileSync).not.toHaveBeenCalledWith("bun", expect.anything(), expect.anything());
  });

  it("runs bun run build when route files changed", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("src/app/page.tsx")
      .mockReturnValueOnce(undefined); // bun run build
    const stdout = { write: vi.fn() };
    nextBuildStep.fn({ execFileSync, stdout, repoRoot: "/root", env: {} });
    expect(execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "build"],
      expect.objectContaining({ cwd: "/root" }),
    );
  });

  it("runs build when changedFiles is null (cannot determine base)", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce(undefined); // bun run build
    const stdout = { write: vi.fn() };
    nextBuildStep.fn({ changedFiles: null, execFileSync, stdout, repoRoot: "/root", env: {} });
    expect(execFileSync).toHaveBeenCalledWith("bun", ["run", "build"], expect.anything());
  });
});
