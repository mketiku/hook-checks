import { execFileSync as defaultExecFileSync } from "node:child_process";
import { getPushMetadata } from "../utils.mjs";

const JS_TS_RE = /\.(tsx?|jsx?|mjs|cjs)$/;

export const lintStep = {
  label: "lint",
  fn(context) {
    const {
      repoRoot = process.cwd(),
      execFileSync = defaultExecFileSync,
      env = process.env,
      stdout = process.stdout,
    } = context;
    const { changedFiles } = getPushMetadata(context, execFileSync);
    if (changedFiles && !changedFiles.some((f) => JS_TS_RE.test(f))) {
      stdout.write("  ℹ No JS/TS changes — skipping lint\n");
      return;
    }
    execFileSync("bun", ["run", "lint"], { cwd: repoRoot, stdio: "inherit", env });
  },
};
