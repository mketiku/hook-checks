import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync as defaultExecFileSync } from "node:child_process";
import { getPushMetadata } from "../utils.mjs";
import { SCHEMA_KEYWORDS } from "./migration.mjs";

/**
 * Parse and validate all content_path entries in a supabase/config.toml.
 *
 * @param {string} configText
 * @param {string} root - Project root
 * @param {(p: string) => boolean} fileExists
 * @returns {{ section: string, rawPath: string, resolved: string }[]}
 */
export function checkSupabaseConfig(configText, root, fileExists) {
  const lines = configText.split("\n");
  let currentSection = "";
  const errors = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      currentSection = trimmed;
      continue;
    }
    const match = trimmed.match(/^content_path\s*=\s*"([^"]+)"/);
    if (!match) continue;

    const rawPath = match[1];
    const isNotification = currentSection.includes("notification");
    const base = isNotification ? join(root, "supabase") : root;
    const resolved = join(base, rawPath);
    if (!fileExists(resolved)) {
      errors.push({ section: currentSection, rawPath, resolved });
    }
  }

  return errors;
}

export const supabaseConfigStep = {
  label: "supabase-config",
  fn(context) {
    const {
      repoRoot = process.cwd(),
      fs = { readFileSync, existsSync },
      execFileSync = defaultExecFileSync,
    } = context;

    const configPath = join(repoRoot, "supabase", "config.toml");
    if (!fs.existsSync(configPath)) return;

    // Only validate when config.toml itself is staged
    const staged = execFileSync("git", ["diff", "--name-only", "--cached"], {
      encoding: "utf8",
    });
    if (!staged.split("\n").includes("supabase/config.toml")) return;

    const errors = checkSupabaseConfig(
      fs.readFileSync(configPath, "utf8"),
      repoRoot,
      fs.existsSync,
    );
    if (errors.length > 0) {
      const detail = errors
        .map(
          (e) =>
            `  [${e.section}] content_path = "${e.rawPath}"\n` +
            `  Resolved to: ${e.resolved}\n` +
            `  File not found.`,
        )
        .join("\n\n");
      throw new Error(
        `supabase/config.toml has ${errors.length} broken content_path reference(s):\n\n${detail}`,
      );
    }
  },
};


/**
 * Creates a pre-push step that fails when a schema-affecting migration is
 * pushed without regenerating the TypeScript types file.
 *
 * @param {{ typesPath?: string }} opts
 */
export function createStaleTypesStep({ typesPath = "src/types/db.ts" } = {}) {
  return {
    label: "stale-types",
    fn(context) {
      const {
        repoRoot = process.cwd(),
        fs = { readFileSync },
        execFileSync = defaultExecFileSync,
      } = context;
      const { changedFiles } = getPushMetadata(context, execFileSync);
      if (!changedFiles) return;

      const changedMigrations = changedFiles.filter((f) =>
        f.startsWith("supabase/migrations/"),
      );
      if (changedMigrations.length === 0) return;

      // Only fail if at least one migration contains schema-affecting SQL.
      // Policy-only, index-only, grant/revoke, and constraint-only migrations
      // don't change the generated TypeScript types.
      const hasSchemaChange = changedMigrations.some((f) => {
        try {
          const sql = fs.readFileSync(join(repoRoot, f), "utf8").replace(/--[^\n]*/g, "");
          return SCHEMA_KEYWORDS.test(sql);
        } catch {
          return false;
        }
      });
      if (!hasSchemaChange) return;

      const hasTypesChange = changedFiles.some((f) => f === typesPath);
      if (hasTypesChange) return;

      // Types weren't modified in this diff. They may still be current if the
      // migration's added identifiers already appear in the types file (e.g.
      // types were regenerated in an earlier commit on the upstream branch).
      const addedIdentifiers = new Set();
      for (const file of changedMigrations) {
        try {
          const sql = fs.readFileSync(join(repoRoot, file), "utf8").replace(/--[^\n]*/g, "");
          for (const m of sql.matchAll(/ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?/gi))
            addedIdentifiers.add(m[1]);
          for (const m of sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:\w+\.)?"?([a-z_][a-z0-9_]*)"?/gi))
            addedIdentifiers.add(m[1]);
          for (const m of sql.matchAll(/CREATE\s+TYPE\s+(?:\w+\.)?"?([a-z_][a-z0-9_]*)"?/gi))
            addedIdentifiers.add(m[1]);
          for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:\w+\.)?"?([a-z_][a-z0-9_]*)"?/gi))
            addedIdentifiers.add(m[1]);
        } catch {
          // ignore unreadable migration files
        }
      }

      if (addedIdentifiers.size > 0) {
        try {
          const typesContent = fs.readFileSync(join(repoRoot, typesPath), "utf8");
          if ([...addedIdentifiers].every((ident) => typesContent.includes(ident))) return;
        } catch {
          // fall through to throw
        }
      }

      throw new Error(
        `Schema-affecting migration added but ${typesPath} was not updated.\n` +
          `Run: bun run generate:types && git add ${typesPath} && git commit --amend --no-edit`,
      );
    },
  };
}

/**
 * Pre-push step: runs `supabase test db` (pgTAP) only when the Supabase local
 * stack is running. Skips gracefully when the stack is down.
 */
export const pgtapStep = {
  label: "pgtap",
  fn(context) {
    const {
      execFileSync = defaultExecFileSync,
      stdout = process.stdout,
    } = context;

    let running = false;
    try {
      const status = execFileSync("bunx", ["supabase", "status"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      running = status.includes("DB URL");
    } catch {
      // supabase CLI not available or stack not initialised
    }

    if (!running) {
      stdout.write("  ⚠ Supabase not running — pgTAP skipped. Run 'bun run db' to enable.\n");
      return;
    }

    execFileSync("bunx", ["supabase", "test", "db"], { stdio: "inherit" });
  },
};
