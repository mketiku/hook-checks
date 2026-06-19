import { spawnSync, execFileSync as defaultExecFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { getPushMetadata } from "../utils.mjs";

const _require = createRequire(import.meta.url);
const TYPECHECK_RELEVANT_RE = /\.(tsx?|jsx?|mjs|cjs|json|d\.ts)$|tsconfig/;

export function generateBuildInfoPath(id = randomBytes(6).toString("hex")) {
  return join(tmpdir(), `typecheck-${id}.tsbuildinfo`);
}

// Standalone typecheck runner — invokes tsc directly with a temp tsBuildInfoFile.
// Used as a CLI: `node typecheck.mjs`. Not used by typecheckStep.
// Requires `typescript` to be installed in the consuming repo.
export function runTypecheck(context = {}) {
  const localTsc = join(_require.resolve("typescript"), "../../bin/tsc");

  const {
    spawnSync: spawnSyncFn = spawnSync,
    rmSync: rm = rmSync,
    exit = process.exit,
    generatePath = generateBuildInfoPath,
    tscBin = localTsc,
  } = context;

  const buildInfoFile = generatePath();
  const result = spawnSyncFn(tscBin, ["--noEmit", "--tsBuildInfoFile", buildInfoFile], {
    stdio: "inherit",
  });
  rm(buildInfoFile, { force: true });
  exit(result.status ?? 1);
}

// Hook step — calls `bun run typecheck` in the repo, skipping when no
// TypeScript-affecting files changed. Requires a `typecheck` npm script.
export const typecheckStep = {
  label: "typecheck",
  fn(context) {
    const {
      repoRoot = process.cwd(),
      execFileSync = defaultExecFileSync,
      env = process.env,
      stdout = process.stdout,
    } = context;
    const { changedFiles } = getPushMetadata(context, execFileSync);
    if (changedFiles && !changedFiles.some((f) => TYPECHECK_RELEVANT_RE.test(f))) {
      stdout.write("  ℹ No TS/config changes — skipping typecheck\n");
      return;
    }
    execFileSync("bun", ["run", "typecheck"], { cwd: repoRoot, stdio: "inherit", env });
  },
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runTypecheck();
}
