import { describe, expect, it } from "vitest";
import { lessonRequestSchema } from "@/app/api/lesson/schema";

const validPlan = {
  title: "Lesson",
  summary: "About things",
  overallDifficulty: "beginner",
  objectives: [
    { id: "obj-1", title: "o", description: "d", difficulty: "beginner" },
  ],
};

const longEnough = "x".repeat(80);

describe("lessonRequestSchema", () => {
  it("accepts a start request", () => {
    const parsed = lessonRequestSchema.safeParse({
      action: "start",
      documentTitle: "Doc",
      sourceText: longEnough,
    });
    expect(parsed.success).toBe(true);
  });

  it("defaults a missing documentTitle instead of failing", () => {
    const parsed = lessonRequestSchema.safeParse({
      action: "start",
      sourceText: longEnough,
    });
    expect(parsed.success && parsed.data.action === "start" && parsed.data.documentTitle).toBe("");
  });

  it("rejects source text too short to build a lesson", () => {
    const parsed = lessonRequestSchema.safeParse({
      action: "start",
      sourceText: "too short",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts each resume verb", () => {
    const verbs = [
      { action: "approve" },
      { action: "skip" },
      { action: "continue" },
      { action: "answer", optionId: "c" },
      { action: "revise", plan: validPlan },
    ];
    for (const resume of verbs) {
      const parsed = lessonRequestSchema.safeParse({
        action: "resume",
        threadId: "t-1",
        resume,
      });
      expect(parsed.success, JSON.stringify(resume)).toBe(true);
    }
  });

  it("rejects an unknown resume verb", () => {
    const parsed = lessonRequestSchema.safeParse({
      action: "resume",
      threadId: "t-1",
      resume: { action: "reveal_answer" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-string optionId", () => {
    // Previously this was cast straight through and compared against the answer
    // key, where it simply never matched instead of being rejected.
    const parsed = lessonRequestSchema.safeParse({
      action: "resume",
      threadId: "t-1",
      resume: { action: "answer", optionId: { toString: "b" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a revise payload whose plan is malformed", () => {
    const parsed = lessonRequestSchema.safeParse({
      action: "resume",
      threadId: "t-1",
      resume: { action: "revise", plan: { title: "only a title" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("requires a threadId to resume", () => {
    const parsed = lessonRequestSchema.safeParse({
      action: "resume",
      threadId: "",
      resume: { action: "approve" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown top-level action", () => {
    expect(lessonRequestSchema.safeParse({ action: "delete" }).success).toBe(false);
  });
});
