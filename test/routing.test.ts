import { describe, expect, it } from "vitest";
import { afterAdvance, afterAsk } from "@/agent/graph";
import type { LessonGraphState } from "@/agent/graph";

function state(patch: Partial<LessonGraphState>): LessonGraphState {
  return {
    phase: "quizzing",
    documentTitle: "",
    sourceText: "",
    plan: null,
    currentObjectiveIndex: 0,
    currentMCQ: null,
    askedQuestions: [],
    currentAttempts: 0,
    lastWrongOptionId: null,
    route: "",
    results: [],
    summary: null,
    statusMessage: "",
    ...patch,
  } as LessonGraphState;
}

const planWith = (count: number) => ({
  title: "t",
  summary: "s",
  overallDifficulty: "beginner" as const,
  objectives: Array.from({ length: count }, (_, i) => ({
    id: `obj-${i + 1}`,
    title: `o${i + 1}`,
    description: "d",
    difficulty: "beginner" as const,
  })),
});

describe("afterAsk", () => {
  it("sends a correct answer to the reveal step", () => {
    expect(afterAsk(state({ route: "correct" }))).toBe("reveal");
  });

  it("sends a skip straight to advance, with no reveal", () => {
    // Skipping must not expose the explanation for an unanswered question.
    expect(afterAsk(state({ route: "skip" }))).toBe("advance");
  });

  it("loops a wrong answer back to the same question", () => {
    expect(afterAsk(state({ route: "retry" }))).toBe("ask_question");
  });

  it("re-asks rather than advancing when the route is unset", () => {
    // A cleared route means the node re-ran on resume; keeping the learner on
    // the question is the safe default, since advancing would skip an objective.
    expect(afterAsk(state({ route: "" }))).toBe("ask_question");
  });
});

describe("afterAdvance", () => {
  it("generates a question while objectives remain", () => {
    const s = state({ plan: planWith(3), currentObjectiveIndex: 1 });
    expect(afterAdvance(s)).toBe("generate_question");
  });

  it("summarizes once the last objective is done", () => {
    const s = state({ plan: planWith(3), currentObjectiveIndex: 3 });
    expect(afterAdvance(s)).toBe("summarize");
  });

  it("summarizes on the boundary rather than reading past the plan", () => {
    // currentObjectiveIndex === objectives.length is the exact off-by-one that
    // would otherwise index undefined in generate_question.
    const s = state({ plan: planWith(1), currentObjectiveIndex: 1 });
    expect(afterAdvance(s)).toBe("summarize");
  });
});
