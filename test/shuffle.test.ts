import { describe, expect, it } from "vitest";
import { shuffleOptions } from "@/agent/llm";
import type { MCQOption } from "@/lib/types";

const options: MCQOption[] = [
  { id: "a", text: "CORRECT" },
  { id: "b", text: "wrong one" },
  { id: "c", text: "wrong two" },
  { id: "d", text: "wrong three" },
];

describe("shuffleOptions", () => {
  it("keeps correctOptionId pointing at the correct text", () => {
    // The dangerous failure is silent: a mis-mapped key marks a wrong option
    // correct, and nothing in the UI would reveal it. Run it enough times to
    // cover every permutation many times over.
    for (let i = 0; i < 2000; i++) {
      const dealt = shuffleOptions(options, "a");
      const marked = dealt.options.find((o) => o.id === dealt.correctOptionId);
      expect(marked?.text).toBe("CORRECT");
    }
  });

  it("always re-letters into a, b, c, d in order", () => {
    for (let i = 0; i < 200; i++) {
      const dealt = shuffleOptions(options, "a");
      expect(dealt.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    }
  });

  it("preserves the full set of option texts", () => {
    const dealt = shuffleOptions(options, "a");
    expect(dealt.options.map((o) => o.text).sort()).toEqual(
      options.map((o) => o.text).sort(),
    );
  });

  it("spreads the correct answer across all four positions", () => {
    // The bug this exists to fix: models emit the answer first ~75% of the
    // time. Each slot should land near 25% of 4000 draws; 15% is a wide enough
    // band to never flake while still failing a stuck or biased shuffle.
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    const draws = 4000;
    for (let i = 0; i < draws; i++) {
      counts[shuffleOptions(options, "a").correctOptionId] += 1;
    }
    for (const id of ["a", "b", "c", "d"]) {
      expect(counts[id]).toBeGreaterThan(draws * 0.15);
      expect(counts[id]).toBeLessThan(draws * 0.35);
    }
  });

  it("falls back to the model's ordering if the correct id is unknown", () => {
    const dealt = shuffleOptions(options, "z");
    expect(dealt.options).toEqual(options);
    expect(dealt.correctOptionId).toBe("z");
  });

  it("still marks a correct answer when two options share text", () => {
    const dupes: MCQOption[] = [
      { id: "a", text: "same" },
      { id: "b", text: "same" },
      { id: "c", text: "CORRECT" },
      { id: "d", text: "other" },
    ];
    const dealt = shuffleOptions(dupes, "c");
    const marked = dealt.options.find((o) => o.id === dealt.correctOptionId);
    expect(marked?.text).toBe("CORRECT");
  });
});
