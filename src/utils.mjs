import { spawn, execFileSync } from "node:child_process";

export function tail(text, lineCount = 80) {
  const lines = text.trimEnd().split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - lineCount)).join("\n");
}

// Extract only the actionable signal from a vitest run: FAIL blocks,
// coverage threshold errors, and the summary lines. Skips passing-test
// progress output and the full coverage table, which are noise on failure.
export function extractVitestFailures(output) {
  const lines = output.split(/\r?\n/);
  const result = [];
  let state = "before";

  for (const line of lines) {
    if ((state === "before" || state === "table") && /⎯+\s*Failed Tests\s+\d+/.test(line)) {
      state = "failures";
      result.push(line);
      continue;
    }

    if (state === "before") continue;

    if (state === "failures") {
      result.push(line);
      const m = line.match(/⎯+\[(\d+)\/(\d+)\]⎯+/);
      if (m && m[1] === m[2]) state = "summary";
      continue;
    }

    if (state === "summary") {
      if (/^\s*(Test Files|Tests|Duration)\s/.test(line) || line.trim() === "") {
        if (line.trim() !== "") result.push(line);
        continue;
      }
      state = "table";
    }

    if (state === "table") {
      if (/\bERROR\b.*[Cc]overage/.test(line) || /does not meet.*threshold/i.test(line)) {
        result.push(line);
      }
      continue;
    }
  }

  if (state === "before") {
    const errorLines = lines.filter(
      (l) => /\bERROR\b.*[Cc]overage/.test(l) || /does not meet.*threshold/i.test(l),
    );
    if (errorLines.length > 0) {
      for (const line of lines) {
        if (/^\s*(Test Files|Tests)\s/.test(line)) result.push(line);
      }
      result.push(...errorLines);
    }
  }

  return result.join("\n").trim();
}

export const defaultSpawn = spawn;
export const defaultExecFileSync = execFileSync;

export function getPushBase(execFileSyncFn = defaultExecFileSync) {
  try {
    return execFileSyncFn("git", ["rev-parse", "@{u}"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    try {
      return execFileSyncFn("git", ["rev-parse", "origin/main"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      return null;
    }
  }
}

export function getChangedFilesForBase(execFileSyncFn = defaultExecFileSync, base) {
  return execFileSyncFn("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function hasOwn(context, key) {
  return Object.prototype.hasOwnProperty.call(context, key);
}

export function getPushMetadata(context, execFileSyncFn = defaultExecFileSync) {
  const pushBase = hasOwn(context, "pushBase")
    ? context.pushBase
    : getPushBase(execFileSyncFn);
  const changedFiles = hasOwn(context, "changedFiles")
    ? context.changedFiles
    : pushBase
      ? getChangedFilesForBase(execFileSyncFn, pushBase)
      : null;

  return { pushBase, changedFiles };
}
