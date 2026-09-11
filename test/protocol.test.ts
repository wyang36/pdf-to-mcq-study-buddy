import { describe, expect, it } from "vitest";
import { toPublicMCQ } from "@/lib/protocol";
import type { MCQ } from "@/lib/types";

const mcq: MCQ = {
  objectiveId: "obj-1",
  question: "Where do the light-dependent reactions take place?",
  options: [
    { id: "a", text: "The stroma" },
    { id: "b", text: "The thylakoid membranes" },
    { id: "c", text: "The mitochondrial matrix" },
    { id: "d", text: "The cell wall" },
  ],
  correctOptionId: "b",
  explanation: "The document states they occur in the thylakoid membranes.",
  hint: "Think about which membrane system sits inside the chloroplast.",
};

describe("toPublicMCQ", () => {
  it("strips the answer key from what crosses the wire", () => {
    const published = toPublicMCQ(mcq);
    expect(published).not.toHaveProperty("correctOptionId");
    expect(published).not.toHaveProperty("explanation");
  });

  it("does not leak the answer through any remaining field", () => {
    // The whole containment argument is that the answer is absent, not hidden,
    // so assert on the serialized payload the browser actually receives.
    const serialized = JSON.stringify(toPublicMCQ(mcq));
    expect(serialized).not.toContain("correctOptionId");
    expect(serialized).not.toContain(mcq.explanation);
  });

  it("keeps everything the learner and the tutor need", () => {
    const published = toPublicMCQ(mcq);
    expect(published.question).toBe(mcq.question);
    expect(published.options).toEqual(mcq.options);
    expect(published.hint).toBe(mcq.hint);
    expect(published.objectiveId).toBe(mcq.objectiveId);
  });

  it("leaves the source MCQ untouched", () => {
    toPublicMCQ(mcq);
    expect(mcq.correctOptionId).toBe("b");
  });
});
