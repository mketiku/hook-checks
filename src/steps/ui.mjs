import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync as defaultExecFileSync } from "node:child_process";

/**
 * Given a map of { path → file contents }, returns violation strings for any
 * `<input>`, `<textarea>`, or `<select>` that has `text-xs` or `text-sm`
 * within the element's own opening tag. Pure — no fs or git calls.
 *
 * text-xs/text-sm (<16px) on a form control makes iOS Safari auto-zoom on
 * focus — use text-base or larger on interactive form elements.
 *
 * The scan stops at the closing `/>` or `>` of the opening tag so that
 * adjacent label spans in the same parent don't produce false positives.
 */
export function findSmallFontInputViolations(fileContents) {
  const INPUT_TAG = /^[^>]*<(input|textarea|select)\b/i;
  const SMALL_FONT = /\btext-(xs|sm)\b/;
  const TAG_CLOSE = /\/?>[\s]*$/;
  const WINDOW = 8;
  const violations = [];
  for (const [file, content] of Object.entries(fileContents)) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!INPUT_TAG.test(lines[i])) continue;
      const end = Math.min(i + WINDOW, lines.length);
      for (let j = i; j < end; j++) {
        if (SMALL_FONT.test(lines[j])) {
          violations.push(`  ${file}:${j + 1} — ${lines[j].trim().slice(0, 80)}`);
          break;
        }
        // Stop scanning once the opening tag is closed — don't bleed into
        // sibling label text that belongs to the next form element.
        if (j > i && TAG_CLOSE.test(lines[j])) break;
      }
    }
  }
  return violations;
}

/**
 * Pre-commit step: blocks `text-xs`/`text-sm` on form controls in staged
 * `.tsx` files. Accounts for adds, modifies, and renames (not pure copies).
 */
export const inputFontSizeStep = {
  label: "input-font-size",
  fn(context) {
    const {
      repoRoot = process.cwd(),
      fs = { readFileSync },
      execFileSync = defaultExecFileSync,
    } = context;

    const nameStatus = execFileSync(
      "git",
      ["diff", "--cached", "--name-status", "-M"],
      { encoding: "utf8" },
    );

    const staged = [];
    for (const line of nameStatus.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      const status = parts[0];
      if (status === "A" || status === "M") {
        staged.push(parts[1]);
      } else if (status.startsWith("R") && status !== "R100") {
        staged.push(parts[2]);
      }
    }

    const stagedTsx = staged.filter((f) => f.endsWith(".tsx"));
    if (stagedTsx.length === 0) return;

    const fileContents = {};
    for (const file of stagedTsx) {
      try {
        fileContents[file] = fs.readFileSync(join(repoRoot, file), "utf8");
      } catch {
        /* file gone (e.g. rename target missing) — skip */
      }
    }

    const violations = findSmallFontInputViolations(fileContents);
    if (violations.length > 0) {
      throw new Error(
        `text-xs/text-sm on form inputs triggers iOS Safari auto-zoom (threshold: 16px).\n` +
          `Use text-base on <input>, <textarea>, and <select>:\n\n` +
          violations.join("\n"),
      );
    }
  },
};
