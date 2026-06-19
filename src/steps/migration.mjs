import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync as defaultExecFileSync } from "node:child_process";
import { getPushMetadata } from "../utils.mjs";

const MIGRATION_RE = /^supabase\/migrations\/.*\.sql$/;

export const migrationRealTimestampsStep = {
  label: "migration-real-timestamps",
  fn(context) {
    const {
      repoRoot = process.cwd(),
      execFileSync = defaultExecFileSync,
    } = context;

    const { changedFiles } = getPushMetadata(context, execFileSync);
    if (!changedFiles) return;

    const addedMigrations = changedFiles.filter((f) => MIGRATION_RE.test(f));
    if (addedMigrations.length === 0) return;

    // Flag any migration whose timestamp ends in 0000 (MM=00, SS=00) —
    // a hand-typed placeholder. Real timestamps from `date +%Y%m%d%H%M%S`
    // almost never land on an exact minute boundary and can't produce
    // identical timestamps on two files created in the same session.
    const offenders = addedMigrations.filter((f) => {
      const m = f.match(/supabase\/migrations\/(\d{14})_/);
      return m && m[1].endsWith("0000");
    });

    if (offenders.length > 0) {
      throw new Error(
        "Migration filename(s) use a hand-typed timestamp (ends in 0000).\n" +
          "Use a real timestamp to guarantee uniqueness:\n\n" +
          "  mv " + offenders[0] + " supabase/migrations/$(date +%Y%m%d%H%M%S)_<name>.sql\n\n" +
          "Offending files:\n" +
          offenders.map((f) => `  ${f}`).join("\n"),
      );
    }
  },
};

export const migrationDropBeforeCreateStep = {
  label: "migration-drop-before-create",
  fn(context) {
    const {
      repoRoot = process.cwd(),
      fs = { readFileSync },
      execFileSync = defaultExecFileSync,
    } = context;

    const { changedFiles } = getPushMetadata(context, execFileSync);
    if (!changedFiles) return;

    const addedMigrations = changedFiles.filter((f) => MIGRATION_RE.test(f));
    if (addedMigrations.length === 0) return;

    const violations = [];
    for (const f of addedMigrations) {
      let sql;
      try {
        sql = fs.readFileSync(join(repoRoot, f), "utf8");
      } catch {
        continue;
      }
      const stripped = sql
        .replace(/--[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      // Find CREATE FUNCTION (not CREATE OR REPLACE) — these require an
      // explicit DROP IF EXISTS for the exact signature, otherwise Postgres
      // errors if the function already exists with any argument list.
      const createRe = /CREATE\s+FUNCTION\s+(?:\w+\.)?"?(\w+)"?\s*\(/gi;
      const dropRe = /DROP\s+FUNCTION\s+IF\s+EXISTS\s+(?:\w+\.)?"?(\w+)"?\s*\(/gi;

      const created = new Set();
      for (const m of stripped.matchAll(createRe)) {
        created.add(m[1].toLowerCase());
      }
      const dropped = new Set();
      for (const m of stripped.matchAll(dropRe)) {
        dropped.add(m[1].toLowerCase());
      }

      for (const name of created) {
        if (!dropped.has(name)) {
          violations.push(
            `  ${f}: CREATE FUNCTION ${name}() has no preceding DROP FUNCTION IF EXISTS`,
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        "Migration uses CREATE FUNCTION without a preceding DROP FUNCTION IF EXISTS.\n" +
          "This causes 'already exists' errors when the function was previously created\n" +
          "but the migration record was not written (e.g. a partial apply).\n\n" +
          violations.join("\n") +
          "\n\nFix: add DROP FUNCTION IF EXISTS public.<name>(<params>) before each CREATE FUNCTION.\n" +
          "Use CREATE OR REPLACE FUNCTION only when the signature (name + arg types + return type) is identical.",
      );
    }
  },
};

export const migrationFnOverloadStep = {
  label: "migration-fn-overload",
  fn(context) {
    const {
      repoRoot = process.cwd(),
      fs = { readFileSync },
      execFileSync = defaultExecFileSync,
    } = context;

    const { changedFiles } = getPushMetadata(context, execFileSync);
    if (!changedFiles) return;

    const changedMigrations = changedFiles
      .filter((f) => MIGRATION_RE.test(f))
      .sort();
    if (changedMigrations.length === 0) return;

    // All migration files known to git at HEAD (includes the new ones)
    const allMigrations = execFileSync(
      "git",
      ["ls-files", "supabase/migrations/"],
      { encoding: "utf8", cwd: repoRoot },
    )
      .split("\n")
      .filter((f) => f.endsWith(".sql"))
      .sort();

    function extractSigs(sql) {
      const sigs = new Map();
      const stripped = sql
        .replace(/--[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const re =
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:\w+\.)?"?(\w+)"?\s*\(([^)]*)\)/gi;
      for (const m of stripped.matchAll(re)) {
        const name = m[1].toLowerCase();
        const paramCount = m[2].trim() === "" ? 0 : m[2].split(",").length;
        if (!sigs.has(name)) sigs.set(name, new Set());
        sigs.get(name).add(paramCount);
      }
      return sigs;
    }

    function extractDrops(sql) {
      const dropped = new Set();
      const stripped = sql
        .replace(/--[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const re =
        /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:\w+\.)?"?(\w+)"?\s*\(/gi;
      for (const m of stripped.matchAll(re)) {
        dropped.add(m[1].toLowerCase());
      }
      return dropped;
    }

    // Build prior-signature map from migrations NOT in the changed set.
    const priorSigs = new Map();
    for (const f of allMigrations) {
      if (changedMigrations.includes(f)) continue;
      let sql;
      try {
        sql = fs.readFileSync(join(repoRoot, f), "utf8");
      } catch {
        continue;
      }
      for (const [name, counts] of extractSigs(sql)) {
        if (!priorSigs.has(name)) priorSigs.set(name, new Set());
        for (const c of counts) priorSigs.get(name).add(c);
      }
    }

    const violations = [];
    for (const f of changedMigrations) {
      let sql;
      try {
        sql = fs.readFileSync(join(repoRoot, f), "utf8");
      } catch {
        continue;
      }
      const newSigs = extractSigs(sql);
      const drops = extractDrops(sql);

      for (const [name, newCounts] of newSigs) {
        const prior = priorSigs.get(name);
        if (!prior) continue;
        for (const newCount of newCounts) {
          for (const priorCount of prior) {
            if (newCount !== priorCount && !drops.has(name)) {
              violations.push(
                `  ${f}: "${name}" prior arity=${priorCount}, new arity=${newCount} — add DROP FUNCTION IF EXISTS for the old signature`,
              );
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        "Migration creates a Postgres function overload without dropping the old signature.\n" +
          "PostgREST cannot disambiguate overloads and will return HTTP 500.\n\n" +
          violations.join("\n") +
          "\n\nFix: add DROP FUNCTION IF EXISTS public.<name>(<old params>) before the CREATE.",
      );
    }
  },
};
