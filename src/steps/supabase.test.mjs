import { describe, it, expect, vi } from "vitest";
import { checkSupabaseConfig, supabaseConfigStep, createStaleTypesStep, pgtapStep } from "./supabase.mjs";

describe("checkSupabaseConfig", () => {
  it("returns empty array when all content_paths resolve", () => {
    const configText = '[auth.email]\ncontent_path = "templates/confirm.html"';
    const errors = checkSupabaseConfig(configText, "/root", () => true);
    expect(errors).toEqual([]);
  });

  it("returns errors for missing files", () => {
    const configText = '[auth.email]\ncontent_path = "templates/missing.html"';
    const errors = checkSupabaseConfig(configText, "/root", () => false);
    expect(errors).toHaveLength(1);
    expect(errors[0].rawPath).toBe("templates/missing.html");
    expect(errors[0].section).toBe("[auth.email]");
  });

  it("resolves notification paths relative to supabase/", () => {
    const configText = '[auth.email.notification]\ncontent_path = "tmpl/foo.html"';
    const exists = vi.fn().mockReturnValue(true);
    checkSupabaseConfig(configText, "/root", exists);
    expect(exists).toHaveBeenCalledWith(expect.stringContaining("supabase/tmpl/foo.html"));
  });

  it("resolves non-notification paths relative to root", () => {
    const configText = '[auth.email]\ncontent_path = "tmpl/foo.html"';
    const exists = vi.fn().mockReturnValue(true);
    checkSupabaseConfig(configText, "/root", exists);
    expect(exists).toHaveBeenCalledWith(expect.stringContaining("/root/tmpl/foo.html"));
    expect(exists).not.toHaveBeenCalledWith(expect.stringContaining("supabase/tmpl/foo.html"));
  });

  it("ignores lines without content_path", () => {
    const configText = '[section]\nsite_url = "https://example.com"\nsome_key = "value"';
    const errors = checkSupabaseConfig(configText, "/root", () => false);
    expect(errors).toEqual([]);
  });
});

describe("supabaseConfigStep", () => {
  it("has label 'supabase-config'", () => {
    expect(supabaseConfigStep.label).toBe("supabase-config");
  });

  it("skips when config.toml does not exist", () => {
    const execFileSync = vi.fn();
    const fs = { existsSync: vi.fn().mockReturnValue(false), readFileSync: vi.fn() };
    supabaseConfigStep.fn({ execFileSync, fs, repoRoot: "/root" });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("skips when config.toml is not staged", () => {
    const execFileSync = vi.fn().mockReturnValue("src/foo.ts");
    const fs = {
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn(),
    };
    supabaseConfigStep.fn({ execFileSync, fs, repoRoot: "/root" });
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("throws when config.toml is staged and has broken content_path", () => {
    const execFileSync = vi.fn().mockReturnValue("supabase/config.toml");
    const fs = {
      existsSync: vi.fn().mockImplementation((p) => p.endsWith("config.toml")),
      readFileSync: vi.fn().mockReturnValue('[section]\ncontent_path = "missing.txt"'),
    };
    expect(() => supabaseConfigStep.fn({ execFileSync, fs, repoRoot: "/root" })).toThrow(
      "broken content_path reference",
    );
  });

  it("passes when config.toml is staged and all content_paths resolve", () => {
    const execFileSync = vi.fn().mockReturnValue("supabase/config.toml");
    const fs = {
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue('[section]\ncontent_path = "present.txt"'),
    };
    expect(() => supabaseConfigStep.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });
});

describe("createStaleTypesStep", () => {
  it("returns a step with label 'stale-types'", () => {
    expect(createStaleTypesStep().label).toBe("stale-types");
  });

  it("skips when changedFiles is null (cannot determine base)", () => {
    const step = createStaleTypesStep();
    const execFileSync = vi.fn().mockImplementation(() => { throw new Error("git error"); });
    step.fn({ execFileSync });
    expect(execFileSync).toHaveBeenCalledTimes(2); // rev-parse @{u} + rev-parse origin/main both fail
  });

  it("skips when no migrations changed", () => {
    const step = createStaleTypesStep();
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base-sha")
      .mockReturnValueOnce("other-file.txt");
    step.fn({ execFileSync });
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it("skips when migration has no schema-affecting SQL", () => {
    const step = createStaleTypesStep();
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/1.sql");
    const fs = {
      readFileSync: vi.fn().mockReturnValue("CREATE POLICY foo ON bar;"),
    };
    expect(() => step.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });

  it("throws when schema change present but types file not updated", () => {
    const step = createStaleTypesStep();
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/1.sql");
    const fs = {
      readFileSync: vi.fn().mockImplementation((p) => {
        if (String(p).endsWith("1.sql")) return "ALTER TABLE foo ADD COLUMN bar text";
        if (String(p).endsWith("db.ts")) return "// no matching identifier";
        return "";
      }),
    };
    expect(() => step.fn({ execFileSync, fs, repoRoot: "/root" })).toThrow("was not updated");
  });

  it("passes when migration column already appears in types file", () => {
    const step = createStaleTypesStep();
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/1.sql");
    const fs = {
      readFileSync: vi.fn().mockImplementation((p) => {
        if (String(p).endsWith("1.sql")) return "ALTER TABLE foo ADD COLUMN ai_score float";
        if (String(p).endsWith("db.ts")) return "ai_score: number | null";
        return "";
      }),
    };
    expect(() => step.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });

  it("passes when the types file itself is in the changed set", () => {
    const step = createStaleTypesStep();
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/1.sql\nsrc/types/db.ts");
    const fs = {
      readFileSync: vi.fn().mockReturnValue("ALTER TABLE foo ADD COLUMN bar text"),
    };
    expect(() => step.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });

  it("respects a custom typesPath", () => {
    const step = createStaleTypesStep({ typesPath: "lib/db.ts" });
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/1.sql\nlib/db.ts");
    const fs = {
      readFileSync: vi.fn().mockReturnValue("ALTER TABLE foo ADD COLUMN bar text"),
    };
    expect(() => step.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });

  it("ignores schema keywords in SQL comments", () => {
    const step = createStaleTypesStep();
    const execFileSync = vi.fn()
      .mockReturnValueOnce("base")
      .mockReturnValueOnce("supabase/migrations/1.sql");
    const fs = {
      readFileSync: vi.fn().mockImplementation((p) => {
        if (String(p).endsWith("1.sql"))
          return "-- A bare CREATE TABLE in a comment\nCREATE TABLE IF NOT EXISTS real_table (id text PRIMARY KEY);";
        if (String(p).endsWith("db.ts")) return "real_table: { id: string }";
        return "";
      }),
    };
    expect(() => step.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });
});

describe("pgtapStep", () => {
  it("has label 'pgtap'", () => {
    expect(pgtapStep.label).toBe("pgtap");
  });

  it("skips when supabase status does not include DB URL", () => {
    const execFileSync = vi.fn().mockReturnValueOnce("Local is not running.");
    const stdout = { write: vi.fn() };
    pgtapStep.fn({ execFileSync, stdout });
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("pgTAP skipped"));
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it("runs supabase test db when stack is up", () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce("DB URL: postgresql://...")
      .mockReturnValueOnce(undefined);
    const stdout = { write: vi.fn() };
    pgtapStep.fn({ execFileSync, stdout });
    expect(execFileSync).toHaveBeenLastCalledWith("bunx", ["supabase", "test", "db"], { stdio: "inherit" });
  });

  it("skips gracefully when supabase CLI throws", () => {
    const execFileSync = vi.fn().mockImplementationOnce(() => { throw new Error("not found"); });
    const stdout = { write: vi.fn() };
    expect(() => pgtapStep.fn({ execFileSync, stdout })).not.toThrow();
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("pgTAP skipped"));
  });
});
