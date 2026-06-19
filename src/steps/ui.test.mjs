import { describe, it, expect, vi } from "vitest";
import { findSmallFontInputViolations, inputFontSizeStep } from "./ui.mjs";

describe("findSmallFontInputViolations", () => {
  it("flags text-xs/text-sm within 8 lines of a form control", () => {
    const v = findSmallFontInputViolations({
      "a.tsx": `<input\n  type="text"\n  className="border text-sm"\n/>`,
      "b.tsx": `<textarea className="text-xs" />`,
    });
    expect(v).toHaveLength(2);
    expect(v[0]).toContain("a.tsx:3");
    expect(v[1]).toContain("b.tsx:1");
  });

  it("does not flag inputs using an accessible size", () => {
    expect(
      findSmallFontInputViolations({
        "ok.tsx": `<input className="border text-base px-2" />`,
      }),
    ).toEqual([]);
  });

  it("does not flag text-xs unrelated to a form control", () => {
    expect(
      findSmallFontInputViolations({
        "label.tsx": `<span className="text-xs text-neutral-500">hint</span>`,
      }),
    ).toEqual([]);
  });

  it("respects the 8-line proximity window", () => {
    const far = `<input />\n${"x\n".repeat(10)}<p className="text-xs" />`;
    expect(findSmallFontInputViolations({ "far.tsx": far })).toEqual([]);
  });

  it("returns [] for no files", () => {
    expect(findSmallFontInputViolations({})).toEqual([]);
  });

  it("flags select and textarea as well as input", () => {
    expect(
      findSmallFontInputViolations({
        "s.tsx": `<select className="text-xs" />`,
        "t.tsx": `<textarea className="text-sm" />`,
      }),
    ).toHaveLength(2);
  });
});

describe("inputFontSizeStep", () => {
  it("has label 'input-font-size'", () => {
    expect(inputFontSizeStep.label).toBe("input-font-size");
  });

  it("skips when no .tsx files are staged", () => {
    const execFileSync = vi.fn().mockReturnValueOnce("M\tsrc/foo.ts\n");
    expect(() => inputFontSizeStep.fn({ execFileSync, repoRoot: "/root" })).not.toThrow();
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it("throws when a staged .tsx file has a violation", () => {
    const execFileSync = vi.fn().mockReturnValueOnce("M\tsrc/foo.tsx\n");
    const fs = { readFileSync: vi.fn().mockReturnValueOnce(`<input className="text-xs" />`) };
    expect(() => inputFontSizeStep.fn({ execFileSync, fs, repoRoot: "/root" })).toThrow(
      "iOS Safari auto-zoom",
    );
  });

  it("passes when staged .tsx files have no violations", () => {
    const execFileSync = vi.fn().mockReturnValueOnce("M\tsrc/foo.tsx\n");
    const fs = { readFileSync: vi.fn().mockReturnValueOnce(`<input className="text-base" />`) };
    expect(() => inputFontSizeStep.fn({ execFileSync, fs, repoRoot: "/root" })).not.toThrow();
  });
});
