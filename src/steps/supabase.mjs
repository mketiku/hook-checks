import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync as defaultExecFileSync } from "node:child_process";

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
