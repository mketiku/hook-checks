import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const _require = createRequire(import.meta.url);
const localTsc = join(_require.resolve("typescript"), "../../bin/tsc");

export function generateBuildInfoPath(id = randomBytes(6).toString("hex")) {
  return join(tmpdir(), `typecheck-${id}.tsbuildinfo`);
}

export function runTypecheck(context = {}) {
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

// Hook step — calls `bun run typecheck` in the repo.
// Requires the consuming repo to have a `typecheck` npm script.
export const typecheckStep = {
  label: "typecheck",
  command: "bun",
  args: ["run", "typecheck"],
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runTypecheck();
}
