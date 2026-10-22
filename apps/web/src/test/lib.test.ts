import { describe, expect, it } from "vitest";
import { messageFrom } from "../api/http";
import { joinPatches, parseDiff } from "../lib/diff";
import { countBySeverity, findingKey, sortFindings } from "../lib/format";
import { toSarif } from "../lib/sarif";
import { SEED_PROJECTS } from "../demo/seed";
import { checkArchive, MAX_ZIP } from "../components/NewAssessment";

const findings = SEED_PROJECTS[0].assessments[1].findings;

describe("parseDiff", () => {
  it("tracks old and new line numbers and counts", () => {
    const [f] = parseDiff(findings[0].proposed_fix!.diff);
    expect(f.newPath).toBe("app/db/users.py");
    expect(f.added).toBe(2);
    expect(f.removed).toBe(2);
    const firstDel = f.lines.find((l) => l.kind === "del")!;
    const firstAdd = f.lines.find((l) => l.kind === "add")!;
    expect(firstDel.oldNo).toBe(41);
    expect(firstAdd.newNo).toBe(41);
  });

  it("joins several fixes into one patch", () => {
    const p = joinPatches([{ id: "F-1", title: "a", diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b" }]);
    expect(p).toContain("# F-1: a");
    expect(p.endsWith("\n")).toBe(true);
  });
});

describe("messageFrom", () => {
  it("uses the gateway's detail string", () => {
    expect(messageFrom(401, { detail: "Invalid e-mail or password" })).toBe("Invalid e-mail or password");
  });
  it("turns validation errors into a sentence", () => {
    expect(messageFrom(422, { detail: [{ loc: ["body", "email"], msg: "value is not a valid email address" }] }))
      .toBe("email: value is not a valid email address");
  });
  it("never leaks internals for server errors", () => {
    expect(messageFrom(500, "Traceback (most recent call last)")).not.toMatch(/Traceback/);
  });
});

describe("findings helpers", () => {
  it("excludes false positives from severity counts", () => {
    const c = countBySeverity(findings);
    expect(c.low).toBe(0);
    expect(c.high).toBe(2);
  });
  it("sorts by severity then confidence", () => {
    const s = sortFindings(findings, "severity");
    expect(s[0].severity).toBe("high");
    expect(s[0].confidence).toBeGreaterThanOrEqual(s[1].confidence);
    expect(s[s.length - 1].severity).toBe("low");
  });
  it("matches findings across assessments by title and file", () => {
    expect(findingKey(findings[0])).toBe("SQL injection in user lookup|app/db/users.py");
  });
});

describe("SARIF export", () => {
  it("produces a 2.1.0 log with suppressed false positives", () => {
    const log = toSarif({ id: "a", project_name: "p", tools: [] }, findings);
    expect(log.version).toBe("2.1.0");
    expect(log.runs[0].results).toHaveLength(findings.length);
    const fp = log.runs[0].results.find((r) => r.properties.status === "false_positive")!;
    expect(fp.level).toBe("none");
    expect(fp.suppressions).toBeDefined();
  });
});

describe("ZIP checks (SUBM-2)", () => {
  it("accepts a normal archive", () => {
    expect(checkArchive(new File(["x"], "app.zip"))).toBeNull();
  });
  it("rejects other formats, empty files and archives over 100 MB", () => {
    expect(checkArchive(new File(["x"], "app.tar.gz"))).toMatch(/Only .zip/);
    expect(checkArchive(new File([], "app.zip"))).toMatch(/empty/);
    const big = new File(["x"], "big.zip");
    Object.defineProperty(big, "size", { value: MAX_ZIP + 1 });
    expect(checkArchive(big)).toMatch(/100 MB/);
  });
});
