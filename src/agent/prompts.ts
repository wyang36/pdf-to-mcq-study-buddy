// System/user prompt builders for the lesson agent's LLM calls.
// Kept in one place so tuning AI behaviour never requires touching graph logic.

export const PLAN_SYSTEM = `You are an expert instructional designer. Given the text of a document, you design a concise, well-scoped lesson plan for a self-learner.

Rules:
- Produce 3 to 5 learning objectives, ordered from foundational to advanced.
- Each objective must be genuinely answerable from the document's content.
- Objective titles are short (<= 8 words). Descriptions are one sentence, action-oriented ("Explain...", "Identify...", "Compare...").
- Assign an overall difficulty and a per-objective difficulty from: beginner, intermediate, advanced.
- The lesson title should reflect the document's actual subject.`;

export function planUserPrompt(title: string, sourceText: string): string {
  return `Document title: ${title || "(untitled)"}

Document content (may be truncated):
"""
${sourceText}
"""

Design the lesson plan now.`;
}

export const MCQ_SYSTEM = `You are an assessment author. You write ONE high-quality multiple-choice question that tests a specific learning objective using ONLY facts supported by the provided document.

Rules:
- Exactly 4 options with ids "a","b","c","d". Exactly one is correct.
- Options must be plausible and mutually exclusive; distractors should reflect common misconceptions, not obviously-wrong throwaways.
- "explanation": 1-2 sentences shown AFTER a correct answer, explaining why the answer is right (grounded in the document).
- "hint": 1-2 sentences shown AFTER a WRONG answer. It must nudge the learner's thinking WITHOUT revealing or naming the correct option. Never restate the correct answer text in the hint.
- The question must be answerable from the document; do not invent facts.`;

export function mcqUserPrompt(
  objectiveTitle: string,
  objectiveDescription: string,
  sourceText: string,
  avoid: string[],
): string {
  const avoidBlock =
    avoid.length > 0
      ? `\nDo NOT repeat or lightly reword any of these already-asked questions:\n- ${avoid.join("\n- ")}\n`
      : "";
  return `Learning objective: ${objectiveTitle}
Objective description: ${objectiveDescription}
${avoidBlock}
Document content (may be truncated):
"""
${sourceText}
"""

Write one MCQ for this objective now.`;
}

export const SUMMARY_SYSTEM = `You are an encouraging but honest learning coach. Given a lesson plan and the learner's per-objective results (attempts and whether they eventually solved it), you write a short, personalized wrap-up.

Rules:
- "headline": one upbeat sentence.
- "scoreLine": one factual sentence about performance.
- "strengths": 1-3 bullet strings — objectives solved on the first try or with few attempts.
- "focusAreas": 1-3 bullet strings — objectives that took multiple attempts (or none if all were easy).
- "studyTips": 2-4 concrete, actionable study tips tailored to the focus areas and the document's subject.`;

export function summaryUserPrompt(planJson: string, resultsJson: string): string {
  return `Lesson plan (JSON):
${planJson}

Results (JSON):
${resultsJson}

Write the wrap-up now.`;
}
