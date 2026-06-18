import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync as defaultExecFileSync } from "node:child_process";

export const actionlintStep = {
  label: "actionlint",
  fn(context) {
    const {
      repoRoot = process.cwd(),
      fs = { existsSync },
      execFileSync = defaultExecFileSync,
      env = process.env,
      stdout = process.stdout,
    } = context;

    const staged = execFileSync(
      "git",
      ["diff", "--name-only", "--cached", "--diff-filter=d"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((p) => p.startsWith(".github/workflows/") && /\.ya?ml$/.test(p));

    if (staged.length === 0) return;

    const localBin = join(repoRoot, "node_modules", ".bin", "actionlint");
    let bin;
    if (fs.existsSync(localBin)) {
      bin = localBin;
    } else {
      try {
        execFileSync("which", ["actionlint"], { stdio: "pipe" });
        bin = "actionlint";
      } catch {
        stdout.write(
          "  ⚠ actionlint not found — skipping locally (CI enforces). Install: brew install actionlint\n",
        );
        return;
      }
    }

    try {
      execFileSync(bin, staged, {
        stdio: "inherit",
        env: { ...env, SHELLCHECK_OPTS: "-S warning" },
      });
    } catch {
      throw new Error("actionlint reported issues in staged workflow files");
    }
  },
};
