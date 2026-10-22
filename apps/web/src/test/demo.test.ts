import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoPlatform, resetDemo } from "../demo/store";

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); resetDemo(); });
afterEach(() => vi.useRealTimers());

const run = <T,>(p: Promise<T>) => { vi.advanceTimersByTime(2000); return p; };

describe("sample data platform", () => {
  it("lists the guide's scenarios as projects", async () => {
    const ps = await run(demoPlatform.listProjects());
    expect(ps.map((p) => p.name)).toEqual(expect.arrayContaining(["hostel-booking", "school-fees-portal", "nightly-db-backup"]));
  });

  it("keeps the funnel consistent with the findings", async () => {
    const a = await run(demoPlatform.getAssessment("a-hostel-2"));
    const fs = await run(demoPlatform.listFindings("a-hostel-2"));
    expect(a.state).toBe("completed");
    expect(a.funnel.raw).toBeGreaterThanOrEqual(a.funnel.merged);
    expect(a.funnel.merged).toBe(fs.length);
    expect(a.funnel.validated).toBe(fs.filter((f) => f.status === "validated").length);
    expect(a.funnel.approved).toBe(fs.filter((f) => f.decision === "approved").length);
  });

  it("moves a new assessment through every state (ASMT-3)", async () => {
    const a = await run(demoPlatform.startAssessment("p-fees"));
    expect(a.state).toBe("queued");
    vi.advanceTimersByTime(5000);
    expect((await run(demoPlatform.getAssessment(a.id))).state).toBe("running_scans");
    vi.advanceTimersByTime(14000);
    expect((await run(demoPlatform.getAssessment(a.id))).state).toBe("ai_analysing");
    vi.advanceTimersByTime(10000);
    expect((await run(demoPlatform.getAssessment(a.id))).state).toBe("completed");
  });

  it("refuses a second assessment while one is running", async () => {
    await run(demoPlatform.startAssessment("p-shop"));
    await expect(run(demoPlatform.startAssessment("p-shop"))).rejects.toThrow(/still running/);
  });

  it("cancels and retries (ASMT-5, ASMT-6)", async () => {
    const a = await run(demoPlatform.startAssessment("p-backup"));
    const c = await run(demoPlatform.cancelAssessment(a.id));
    expect(c.state).toBe("cancelled");
    const r = await run(demoPlatform.retryAssessment(a.id));
    expect(r.state).toBe("queued");
  });

  it("records decisions and overrides (REV-4, REV-5)", async () => {
    const f = await run(demoPlatform.decide("a-hostel-2", "F-0012", "approved", "looks right"));
    expect(f.decision).toBe("approved");
    expect(f.decision_comment).toBe("looks right");
    const back = await run(demoPlatform.reclassify("a-hostel-2", "F-0017", "validated", "user input reaches it"));
    expect(back.status).toBe("validated");
    const a = await run(demoPlatform.getAssessment("a-hostel-2"));
    expect(a.funnel.approved).toBe(2);
  });

  it("compares two assessments (REPT-4)", async () => {
    const c = await run(demoPlatform.compare("a-hostel-1", "a-hostel-2"));
    expect(c.resolved.map((f) => f.id)).toContain("F-0009");
    expect(c.new.map((f) => f.id)).toContain("F-0015");
    expect(c.unchanged.length).toBeGreaterThan(0);
  });

  it("assistant refuses to edit code (CHAT-4)", async () => {
    const m = await run(demoPlatform.ask("a-hostel-2", "please change the file for me", "F-0012"));
    expect(m.text).toMatch(/can't change files/);
  });
});
