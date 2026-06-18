import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tail,
  defaultSpawn,
  defaultExecFileSync,
  getPushBase,
  getChangedFilesForBase,
} from "./utils.mjs";

export function shouldRunPrePush(input, stdout = process.stdout) {
  if (!input) return true;
  const lines = input.trim().split("\n");
  let shouldRun = false;

  for (const line of lines) {
    const parts = line.split(" ");
    if (parts.length < 4) continue;
    const [, localSha, remoteRef, remoteSha] = parts;

    if (localSha === "0000000000000000000000000000000000000000") {
      stdout.write(`ℹ Skipping checks for deletion of ${remoteRef}\n`);
      continue;
    }

    if (localSha === remoteSha) {
      stdout.write(`ℹ Skipping checks: ${remoteRef} is already up to date\n`);
      continue;
    }

    shouldRun = true;
  }

  return shouldRun || lines.length === 0;
}

export async function collectStdin(stdin = process.stdin) {
  if (stdin.isTTY) return "";

  return new Promise((resolve) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => { data += chunk; });
    stdin.on("end", () => resolve(data));
    stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 200);
  });
}

export async function runStep(step, logFile, context) {
  const {
    stdout = process.stdout,
    stderr = process.stderr,
    repoRoot = process.cwd(),
    env = process.env,
    spawn = defaultSpawn,
    fs = { createWriteStream, readFileSync },
    compactMode = false,
  } = context;

  if (!compactMode) stdout.write(`→ ${step.label}\n`);
  const stepStart = Date.now();
  const elapsed = () => `${((Date.now() - stepStart) / 1000).toFixed(1)}s`;

  if (step.fn) {
    try {
      await step.fn(context);
    } catch (err) {
      stderr.write(`✖ ${step.label} failed (${elapsed()})\n`);
      stderr.write(`${err.message}\n`);
      return false;
    }
    stdout.write(compactMode ? `[pass] ${step.label}: ${elapsed()}\n` : `  ⏱ ${step.label}: ${elapsed()}\n`);
    return true;
  }

  const logStream = fs.createWriteStream(logFile, { flags: "w" });

  const child = spawn(step.command, step.args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env,
    shell: false,
  });

  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  await new Promise((resolve) => { logStream.end(resolve); });

  if (exitCode !== 0) {
    const log = fs.readFileSync(logFile, "utf8");
    stderr.write(`✖ ${step.label} failed (${elapsed()})\n`);
    stderr.write(`${tail(log)}\n`);
    return false;
  }

  stdout.write(compactMode ? `[pass] ${step.label}: ${elapsed()}\n` : `  ⏱ ${step.label}: ${elapsed()}\n`);
  return true;
}

function hasOwn(context, key) {
  return Object.prototype.hasOwnProperty.call(context, key);
}

// stepsByMode: { "pre-commit": [...steps], "pre-push": [...steps] }
// A step is either { label, command, args } or { label, fn(context) }.
// An array of steps runs in parallel; a bare step runs sequentially.
export async function runMain(stepsByMode, context = {}) {
  const {
    argv = process.argv,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    exit = process.exit,
    fs = { mkdtempSync, rmSync },
    os = { tmpdir },
    repoRoot = process.cwd(),
    execFileSync = defaultExecFileSync,
    logDirPrefix = "hook-checks-",
  } = context;

  const mode = argv[2];
  if (!mode || !(mode in stepsByMode)) {
    stderr.write(`Usage: node <script> <${Object.keys(stepsByMode).join("|")}>\n`);
    exit(1);
    return;
  }

  const compactMode = (context.env ?? process.env).HOOK_COMPACT === "1";
  let stepContext = { ...context, compactMode };

  if (mode === "pre-push") {
    const input = await collectStdin(stdin);
    if (!shouldRunPrePush(input, stdout) && input.trim().length > 0) {
      stdout.write("✅ Skipping pre-push checks (non-functional push)\n");
      return;
    }

    const pushBase = hasOwn(context, "pushBase")
      ? context.pushBase
      : getPushBase(execFileSync);
    const changedFiles = hasOwn(context, "changedFiles")
      ? context.changedFiles
      : pushBase
        ? getChangedFilesForBase(execFileSync, pushBase)
        : null;
    stepContext = { ...stepContext, pushBase, changedFiles };
  }

  const logDir = fs.mkdtempSync(join(os.tmpdir(), logDirPrefix));
  const logFile = join(logDir, `${mode}.log`);

  try {
    for (const entry of stepsByMode[mode]) {
      if (Array.isArray(entry)) {
        if (!compactMode) {
          stdout.write(`→ [parallel] ${entry.map((s) => s.label).join(", ")}\n`);
        }
        const groupStart = Date.now();
        const results = await Promise.all(
          entry.map((step) => runStep(step, `${logFile}.${step.label}`, stepContext)),
        );
        if (!compactMode) {
          const groupElapsed = ((Date.now() - groupStart) / 1000).toFixed(1);
          stdout.write(`  ⏱ [parallel] wall-clock: ${groupElapsed}s\n`);
        }
        if (results.some((ok) => !ok)) exit(1);
      } else {
        const ok = await runStep(entry, logFile, stepContext);
        if (!ok) exit(1);
      }
    }
    stdout.write(`✅ ${mode} checks passed\n`);
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
}
