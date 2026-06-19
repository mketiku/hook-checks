import { describe, it, expect, vi } from "vitest";
import { checkSupabaseConfig, supabaseConfigStep } from "./supabase.mjs";

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
