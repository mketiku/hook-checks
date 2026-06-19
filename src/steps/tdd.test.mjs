import { describe, it, expect, vi } from "vitest";
import {
  findNewSourceWithoutTest,
  createNewSourceNeedsTestStep,
  NEXTJS_ROUTER_BOILERPLATE_NAMES,
} from "./tdd.mjs";

const noFs = () => false;

describe("NEXTJS_ROUTER_BOILERPLATE_NAMES", () => {
  it("includes expected App Router filenames", () => {
    expect(NEXTJS_ROUTER_BOILERPLATE_NAMES).toContain("layout");
    expect(NEXTJS_ROUTER_BOILERPLATE_NAMES).toContain("route");
    expect(NEXTJS_ROUTER_BOILERPLATE_NAMES).toContain("sitemap");
  });
});

describe("findNewSourceWithoutTest", () => {
  it("flags a new source file with no co-located test", () => {
    expect(findNewSourceWithoutTest(["src/features/foo/Bar.tsx"], noFs)).toEqual([
      "src/features/foo/Bar.tsx",
    ]);
  });

  it("passes when test is staged alongside source", () => {
    expect(
      findNewSourceWithoutTest(
        ["src/features/foo/Bar.tsx", "src/features/foo/Bar.test.tsx"],
        noFs,
      ),
    ).toEqual([]);
  });

  it("passes when a co-located test already exists on disk", () => {
    const exists = (p) => p === "src/features/foo/Bar.test.tsx";
    expect(findNewSourceWithoutTest(["src/features/foo/Bar.tsx"], exists)).toEqual([]);
  });

  it("accepts .test.ts as a partner for a .tsx source", () => {
    const exists = (p) => p === "src/features/foo/Bar.test.ts";
    expect(findNewSourceWithoutTest(["src/features/foo/Bar.tsx"], exists)).toEqual([]);
  });

  it("ignores test/spec/story/d.ts files themselves", () => {
    expect(
      findNewSourceWithoutTest(
        [
          "src/features/foo/Bar.test.tsx",
          "src/features/foo/Bar.spec.ts",
          "src/features/foo/Bar.stories.tsx",
          "src/features/foo/Bar.d.ts",
        ],
        noFs,
      ),
    ).toEqual([]);
  });

  it("exempts paths from exemptPaths", () => {
    expect(findNewSourceWithoutTest(["src/types/foo.ts", "src/test/helpers.ts"], noFs)).toEqual([]);
  });

  it("exempts App Router boilerplate names", () => {
    expect(
      findNewSourceWithoutTest(
        [
          "src/app/admin/layout.tsx",
          "src/app/admin/loading.tsx",
          "src/app/admin/error.tsx",
          "src/app/admin/not-found.tsx",
          "src/app/global-error.tsx",
          "src/app/sitemap.ts",
          "src/app/robots.ts",
          "src/app/api/foo/route.ts",
        ],
        noFs,
      ),
    ).toEqual([]);
  });

  it("still flags page.tsx (not in boilerplate list by default)", () => {
    expect(findNewSourceWithoutTest(["src/app/admin/page.tsx"], noFs)).toEqual([
      "src/app/admin/page.tsx",
    ]);
  });

  it("ignores non-src files", () => {
    expect(
      findNewSourceWithoutTest(["scripts/foo.mjs", "supabase/migrations/1.sql"], noFs),
    ).toEqual([]);
  });

  it("respects custom srcRoot", () => {
    expect(
      findNewSourceWithoutTest(["lib/foo.ts"], noFs, { srcRoot: "lib/" }),
    ).toEqual(["lib/foo.ts"]);
    expect(
      findNewSourceWithoutTest(["src/foo.ts"], noFs, { srcRoot: "lib/" }),
    ).toEqual([]);
  });

  it("respects exemptFiles", () => {
    expect(
      findNewSourceWithoutTest(["src/main.tsx"], noFs, { exemptFiles: ["src/main.tsx"] }),
    ).toEqual([]);
    expect(findNewSourceWithoutTest(["src/main.tsx"], noFs)).toEqual(["src/main.tsx"]);
  });

  it("respects empty routerBoilerplateNames", () => {
    expect(
      findNewSourceWithoutTest(["src/app/layout.tsx"], noFs, { routerBoilerplateNames: [] }),
    ).toEqual(["src/app/layout.tsx"]);
  });
});

describe("createNewSourceNeedsTestStep", () => {
  it("returns a step with label 'new-source-needs-test'", () => {
    expect(createNewSourceNeedsTestStep().label).toBe("new-source-needs-test");
  });

  it("skips when SKIP_TEST_REQUIRED=1", () => {
    const step = createNewSourceNeedsTestStep();
    const execFileSync = vi.fn();
    step.fn({ execFileSync, env: { SKIP_TEST_REQUIRED: "1" } });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("skips when no files were added", () => {
    const step = createNewSourceNeedsTestStep();
    const execFileSync = vi.fn().mockReturnValue("");
    const fs = { existsSync: vi.fn() };
    step.fn({ execFileSync, fs, repoRoot: "/root", env: {} });
    expect(fs.existsSync).not.toHaveBeenCalled();
  });

  it("throws when a new source file has no test", () => {
    const step = createNewSourceNeedsTestStep();
    const execFileSync = vi.fn().mockReturnValue("A\tsrc/features/Foo.tsx");
    const fs = { existsSync: vi.fn().mockReturnValue(false) };
    expect(() => step.fn({ execFileSync, fs, repoRoot: "/root", env: {} })).toThrow(
      "co-located test",
    );
  });

  it("passes when a staged test accompanies the source", () => {
    const step = createNewSourceNeedsTestStep();
    const execFileSync = vi
      .fn()
      .mockReturnValue("A\tsrc/features/Foo.tsx\nA\tsrc/features/Foo.test.tsx");
    const fs = { existsSync: vi.fn().mockReturnValue(false) };
    expect(() => step.fn({ execFileSync, fs, repoRoot: "/root", env: {} })).not.toThrow();
  });

  it("passes a custom exemptFiles option through to the checker", () => {
    const step = createNewSourceNeedsTestStep({ exemptFiles: ["src/main.tsx"] });
    const execFileSync = vi.fn().mockReturnValue("A\tsrc/main.tsx");
    const fs = { existsSync: vi.fn().mockReturnValue(false) };
    expect(() => step.fn({ execFileSync, fs, repoRoot: "/root", env: {} })).not.toThrow();
  });
});
