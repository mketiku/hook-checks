import { describe, it, expect, vi } from "vitest";
import {
  migrationRealTimestampsStep,
  migrationDropBeforeCreateStep,
  migrationFnOverloadStep,
  migrationTouchesGeneratedTypes,
  findTestsWithStaleColumnRefs,
  createPgtapRenameGuardStep,
} from "./migration.mjs";

describe("migrationRealTimestampsStep", () => {
  it("has label 'migration-real-timestamps'", () => {
    expect(migrationRealTimestampsStep.label).toBe("migration-real-timestamps");
  });

  it("passes when changed migrations have real timestamps", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/20260618125907_foo.sql");
    expect(() => migrationRealTimestampsStep.fn({ execFileSync, repoRoot: "/root" })).not.toThrow();
  });

  it("throws when a changed migration has a hand-typed 0000 timestamp", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/20260617120000_search.sql");
    expect(() => migrationRealTimestampsStep.fn({ execFileSync, repoRoot: "/root" })).toThrow(
      "hand-typed timestamp",
    );
  });

  it("suggests a copy-pasteable mv command with no <name> placeholder", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/20260617120000_search.sql");
    try {
      migrationRealTimestampsStep.fn({ execFileSync, repoRoot: "/root" });
      throw new Error("expected fn to throw");
    } catch (err) {
      expect(err.message).not.toContain("<name>");
      expect(err.message).toContain(
        "mv supabase/migrations/20260617120000_search.sql supabase/migrations/$(date +%Y%m%d%H%M%S)_search.sql",
      );
    }
  });

  it("skips when no migrations changed", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("src/foo.tsx");
    expect(() => migrationRealTimestampsStep.fn({ execFileSync, repoRoot: "/root" })).not.toThrow();
  });

  it("skips when changedFiles is null", () => {
    expect(() =>
      migrationRealTimestampsStep.fn({ changedFiles: null, repoRoot: "/root" }),
    ).not.toThrow();
  });
});

describe("migrationDropBeforeCreateStep", () => {
  it("has label 'migration-drop-before-create'", () => {
    expect(migrationDropBeforeCreateStep.label).toBe("migration-drop-before-create");
  });

  it("passes when CREATE FUNCTION is preceded by DROP FUNCTION IF EXISTS", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/20260618125907_foo.sql");
    const fs = {
      readFileSync: vi.fn().mockReturnValue(
        "DROP FUNCTION IF EXISTS public.my_fn(text);\nCREATE FUNCTION public.my_fn(p text) RETURNS void LANGUAGE sql AS $$ $$;",
      ),
    };
    expect(() => migrationDropBeforeCreateStep.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });

  it("throws when CREATE FUNCTION has no DROP IF EXISTS", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/20260618125907_foo.sql");
    const fs = {
      readFileSync: vi.fn().mockReturnValue(
        "CREATE FUNCTION public.my_fn(p text) RETURNS void LANGUAGE sql AS $$ $$;",
      ),
    };
    expect(() => migrationDropBeforeCreateStep.fn({ execFileSync, fs, repoRoot: "/root" })).toThrow(
      "DROP FUNCTION IF EXISTS",
    );
  });

  it("passes for CREATE OR REPLACE FUNCTION (not caught by this check)", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/20260618125907_foo.sql");
    const fs = {
      readFileSync: vi.fn().mockReturnValue(
        "CREATE OR REPLACE FUNCTION public.my_fn(p text) RETURNS void LANGUAGE sql AS $$ $$;",
      ),
    };
    expect(() => migrationDropBeforeCreateStep.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });

  it("skips when no migrations changed", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("src/foo.tsx");
    const fs = { readFileSync: vi.fn() };
    expect(() => migrationDropBeforeCreateStep.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("skips when changedFiles is null", () => {
    const fs = { readFileSync: vi.fn() };
    expect(() =>
      migrationDropBeforeCreateStep.fn({ changedFiles: null, fs, repoRoot: "/root" }),
    ).not.toThrow();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });
});

describe("migrationFnOverloadStep", () => {
  it("has label 'migration-fn-overload'", () => {
    expect(migrationFnOverloadStep.label).toBe("migration-fn-overload");
  });

  it("skips when no migrations changed", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("src/foo.tsx");
    const fs = { readFileSync: vi.fn() };
    expect(() => migrationFnOverloadStep.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("skips when changedFiles is null", () => {
    const fs = { readFileSync: vi.fn() };
    expect(() =>
      migrationFnOverloadStep.fn({ changedFiles: null, fs, repoRoot: "/root" }),
    ).not.toThrow();
  });

  it("passes when new migration introduces a function not seen before", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/20260618_new.sql")
      .mockReturnValueOnce("supabase/migrations/20260618_new.sql"); // git ls-files
    const fs = {
      readFileSync: vi.fn().mockReturnValue(
        "CREATE FUNCTION public.brand_new(p text) RETURNS void LANGUAGE sql AS $$ $$;",
      ),
    };
    expect(() => migrationFnOverloadStep.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });

  it("throws when arity changes without a DROP", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      // git diff --name-only: only the new migration changed
      .mockReturnValueOnce("supabase/migrations/20260619_update.sql")
      // git ls-files: both old and new exist
      .mockReturnValueOnce(
        "supabase/migrations/20260618_orig.sql\nsupabase/migrations/20260619_update.sql",
      );
    const fs = {
      readFileSync: vi.fn().mockImplementation((p) => {
        if (String(p).includes("20260618_orig"))
          return "CREATE FUNCTION public.my_fn(a text) RETURNS void LANGUAGE sql AS $$ $$;";
        if (String(p).includes("20260619_update"))
          return "CREATE FUNCTION public.my_fn(a text, b text) RETURNS void LANGUAGE sql AS $$ $$;";
        return "";
      }),
    };
    expect(() => migrationFnOverloadStep.fn({ execFileSync, fs, repoRoot: "/root" })).toThrow(
      "overload",
    );
  });

  it("passes when arity changes but DROP is present", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/20260619_update.sql")
      .mockReturnValueOnce(
        "supabase/migrations/20260618_orig.sql\nsupabase/migrations/20260619_update.sql",
      );
    const fs = {
      readFileSync: vi.fn().mockImplementation((p) => {
        if (String(p).includes("20260618_orig"))
          return "CREATE FUNCTION public.my_fn(a text) RETURNS void LANGUAGE sql AS $$ $$;";
        if (String(p).includes("20260619_update"))
          return "DROP FUNCTION IF EXISTS public.my_fn(a text);\nCREATE FUNCTION public.my_fn(a text, b text) RETURNS void LANGUAGE sql AS $$ $$;";
        return "";
      }),
    };
    expect(() => migrationFnOverloadStep.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });
});

describe("migrationTouchesGeneratedTypes", () => {
  it("returns true for ADD COLUMN", () => {
    expect(migrationTouchesGeneratedTypes(
      "alter table public.profiles add column username citext;"
    )).toBe(true);
  });

  it("returns true for CREATE TABLE", () => {
    expect(migrationTouchesGeneratedTypes("create table public.widgets (id uuid);")).toBe(true);
  });

  it("returns true for DROP TABLE", () => {
    expect(migrationTouchesGeneratedTypes("drop table if exists public.widgets;")).toBe(true);
  });

  it("returns true for RENAME COLUMN", () => {
    expect(migrationTouchesGeneratedTypes(
      "alter table public.foo rename column old_name to new_name;"
    )).toBe(true);
  });

  it("returns false for constraint-only migrations", () => {
    expect(migrationTouchesGeneratedTypes(`
      alter table public.people drop constraint if exists people_user_id_fkey;
      alter table public.people
        add constraint people_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete cascade;
    `)).toBe(false);
  });

  it("returns false for CREATE OR REPLACE FUNCTION (no schema shape change)", () => {
    expect(migrationTouchesGeneratedTypes(
      "create or replace function public.foo() returns void language sql as $$ select 1 $$;"
    )).toBe(false);
  });

  it("strips SQL comments before testing", () => {
    expect(migrationTouchesGeneratedTypes(
      "-- alter table public.foo add column bar text;\nrevoke execute on function public.foo from anon;"
    )).toBe(false);
  });
});

describe("findTestsWithStaleColumnRefs", () => {
  it("returns [] when no renames in migrations", () => {
    const sqls = { "m.sql": "alter table foo add column bar text;" };
    expect(findTestsWithStaleColumnRefs(sqls, { "t.sql": "select bar from foo;" })).toEqual([]);
  });

  it("flags test files referencing the old column name", () => {
    const sqls = { "m.sql": "alter table foo rename column old_col to new_col;" };
    const tests = { "t1.sql": "select old_col from foo;", "t2.sql": "select new_col from foo;" };
    expect(findTestsWithStaleColumnRefs(sqls, tests)).toEqual(["t1.sql"]);
  });

  it("returns [] when all test files use the new column name", () => {
    const sqls = { "m.sql": "alter table foo rename column old_col to new_col;" };
    const tests = { "t.sql": "select new_col from foo;" };
    expect(findTestsWithStaleColumnRefs(sqls, tests)).toEqual([]);
  });
});

describe("createPgtapRenameGuardStep", () => {
  it("has label 'pgtap-rename-guard'", () => {
    expect(createPgtapRenameGuardStep().label).toBe("pgtap-rename-guard");
  });

  it("skips when no migrations changed", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base-sha\n")  // getPushBase: rev-parse @{u}
      .mockReturnValueOnce("src/foo.ts\n");  // git diff --name-only
    expect(() => createPgtapRenameGuardStep().fn({ execFileSync, repoRoot: "/root" })).not.toThrow();
  });

  it("skips when no push base (both rev-parse calls fail)", () => {
    const execFileSync = vi.fn()
      .mockImplementationOnce(() => { throw new Error("no upstream"); })
      .mockImplementationOnce(() => { throw new Error("no origin/main"); });
    expect(() => createPgtapRenameGuardStep().fn({ execFileSync, repoRoot: "/root" })).not.toThrow();
  });
});
