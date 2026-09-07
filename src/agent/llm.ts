// Provider-configurable LLM layer for the lesson agent.
//
// One place decides which model (Anthropic / OpenAI / mock) powers planning,
// MCQ generation, and the summary. Every function degrades to a deterministic
// mock so the full flow runs with no API key — set LLM_PROVIDER=mock (or just
// leave all keys unset) to demo offline.

import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type {
  Difficulty,
  LearningObjective,
  LessonPlan,
  LessonSummary,
  MCQ,
  ObjectiveResult,
} from "@/lib/types";
import {
  MCQ_SYSTEM,
  PLAN_SYSTEM,
  SUMMARY_SYSTEM,
  mcqUserPrompt,
  planUserPrompt,
  summaryUserPrompt,
} from "./prompts";

export type Provider = "anthropic" | "openai" | "mock";

/** Resolve the active provider from env, with auto-detection. */
export function resolveProvider(): Provider {
  const explicit = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (explicit === "anthropic" || explicit === "openai" || explicit === "mock") {
    return explicit;
  }
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "mock";
}

/** Whether a real (non-mock) LLM is configured — used to gate the tutor chat. */
export function hasRealLLM(): boolean {
  return resolveProvider() !== "mock";
}

/** Public accessor for the raw chat model (used by the CopilotKit adapter).
 *  Returns null in mock mode. */
export async function createChatModel() {
  return getModel();
}

// Lazy-load the heavy model libs so mock mode stays light and never imports them.
async function getModel(): Promise<BaseChatModel | null> {
  const provider = resolveProvider();
  if (provider === "anthropic") {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    return new ChatAnthropic({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      temperature: 0.3,
      maxRetries: 2,
    });
  }
  if (provider === "openai") {
    const { ChatOpenAI } = await import("@langchain/openai");
    return new ChatOpenAI({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      temperature: 0.3,
      maxRetries: 2,
    });
  }
  return null;
}

// --- Zod schemas for structured output --------------------------------------

const difficultySchema = z.enum(["beginner", "intermediate", "advanced"]);

const planSchema = z.object({
  title: z.string().describe("Lesson title reflecting the document subject."),
  summary: z.string().describe("Two-sentence overview of the lesson."),
  overallDifficulty: difficultySchema,
  objectives: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        difficulty: difficultySchema,
      }),
    )
    .min(3)
    .max(5),
});

const mcqSchema = z.object({
  question: z.string(),
  options: z
    .array(z.object({ id: z.enum(["a", "b", "c", "d"]), text: z.string() }))
    .length(4),
  correctOptionId: z.enum(["a", "b", "c", "d"]),
  explanation: z.string(),
  hint: z.string(),
});

const summarySchema = z.object({
  headline: z.string(),
  scoreLine: z.string(),
  strengths: z.array(z.string()),
  focusAreas: z.array(z.string()),
  studyTips: z.array(z.string()).min(2).max(4),
});

// --- Public generation API --------------------------------------------------

export async function generatePlan(
  title: string,
  sourceText: string,
): Promise<LessonPlan> {
  const model = await getModel();
  if (model) {
    try {
      const structured = model.withStructuredOutput(planSchema, {
        name: "lesson_plan",
      });
      const raw = (await structured.invoke([
        { role: "system", content: PLAN_SYSTEM },
        { role: "user", content: planUserPrompt(title, sourceText) },
      ])) as z.infer<typeof planSchema>;
      return {
        title: raw.title,
        summary: raw.summary,
        overallDifficulty: raw.overallDifficulty,
        objectives: raw.objectives.map((o, i) => ({
          id: `obj-${i + 1}`,
          title: o.title,
          description: o.description,
          difficulty: o.difficulty,
        })),
      };
    } catch (err) {
      console.error("[llm] generatePlan failed, using mock:", err);
    }
  }
  return mockPlan(title, sourceText);
}

export async function generateMCQ(
  objective: LearningObjective,
  sourceText: string,
  avoidQuestions: string[],
): Promise<MCQ> {
  const model = await getModel();
  if (model) {
    try {
      const structured = model.withStructuredOutput(mcqSchema, { name: "mcq" });
      const raw = (await structured.invoke([
        { role: "system", content: MCQ_SYSTEM },
        {
          role: "user",
          content: mcqUserPrompt(
            objective.title,
            objective.description,
            sourceText,
            avoidQuestions,
          ),
        },
      ])) as z.infer<typeof mcqSchema>;
      return {
        objectiveId: objective.id,
        question: raw.question,
        options: raw.options,
        correctOptionId: raw.correctOptionId,
        explanation: raw.explanation,
        hint: raw.hint,
      };
    } catch (err) {
      console.error("[llm] generateMCQ failed, using mock:", err);
    }
  }
  return mockMCQ(objective, sourceText, avoidQuestions.length);
}

export async function generateSummary(
  plan: LessonPlan,
  results: ObjectiveResult[],
): Promise<LessonSummary> {
  const model = await getModel();
  if (model) {
    try {
      const structured = model.withStructuredOutput(summarySchema, {
        name: "summary",
      });
      const raw = (await structured.invoke([
        { role: "system", content: SUMMARY_SYSTEM },
        {
          role: "user",
          content: summaryUserPrompt(
            JSON.stringify(plan),
            JSON.stringify(results),
          ),
        },
      ])) as z.infer<typeof summarySchema>;
      return raw;
    } catch (err) {
      console.error("[llm] generateSummary failed, using mock:", err);
    }
  }
  return mockSummary(plan, results);
}

// --- Mock implementations (deterministic, no network) -----------------------

/** Split text into reasonably clean sentences. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 320);
}

/** Cheap keyword extraction: most frequent non-trivial words. */
function keywords(text: string, n: number): string[] {
  const stop = new Set(
    "the a an and or but of to in on for with as by at from is are was were be been being this that these those it its their there which who whom whose will would can could should may might must not no yes you your we our they them he she his her".split(
      " ",
    ),
  );
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []) {
    if (stop.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function mockPlan(title: string, sourceText: string): LessonPlan {
  const kws = keywords(sourceText, 5);
  const subject = title?.trim() || (kws[0] ? titleCase(kws[0]) : "the material");
  const diffs: Difficulty[] = ["beginner", "intermediate", "advanced"];
  const objectives: LearningObjective[] = (kws.length ? kws.slice(0, 3) : ["core concepts", "key details", "applications"]).map(
    (kw, i) => ({
      id: `obj-${i + 1}`,
      title: `Understand ${kw}`,
      description: `Explain the role of ${kw} as presented in ${subject}.`,
      difficulty: diffs[Math.min(i, diffs.length - 1)],
    }),
  );
  return {
    title: `Lesson: ${subject}`,
    summary: `A short interactive lesson covering the key ideas in ${subject}. (Generated in mock mode — set an API key for richer, content-grounded questions.)`,
    overallDifficulty: "intermediate",
    objectives,
  };
}

function mockMCQ(
  objective: LearningObjective,
  sourceText: string,
  askedCount: number,
): MCQ {
  const sents = sentences(sourceText);
  const fact =
    sents[(askedCount * 3) % Math.max(sents.length, 1)] ||
    objective.description;
  const correct = fact.length > 140 ? fact.slice(0, 137) + "…" : fact;
  const distractors = [
    "It is explicitly described as irrelevant to the topic.",
    "The document states the opposite of this.",
    "This is never mentioned anywhere in the document.",
  ];
  // Shuffle deterministically so the correct answer isn't always "a".
  const correctSlot = askedCount % 4;
  const options = [] as MCQ["options"];
  const ids = ["a", "b", "c", "d"] as const;
  let d = 0;
  for (let i = 0; i < 4; i++) {
    options.push({
      id: ids[i],
      text: i === correctSlot ? correct : distractors[d++ % distractors.length],
    });
  }
  return {
    objectiveId: objective.id,
    question: `Which statement best reflects "${objective.title}" according to the document?`,
    options,
    correctOptionId: ids[correctSlot],
    explanation: `Correct. The document supports this: "${correct}"`,
    hint: `Re-read the parts of the document about "${objective.title.replace(
      /^Understand /,
      "",
    )}". One option paraphrases the source; the others contradict or ignore it.`,
  };
}

function mockSummary(
  plan: LessonPlan,
  results: ObjectiveResult[],
): LessonSummary {
  const solved = results.filter((r) => r.solved).length;
  const total = plan.objectives.length;
  const firstTry = results.filter((r) => r.solved && r.attempts === 1);
  const struggled = results.filter((r) => r.attempts > 1);
  const byId = new Map(plan.objectives.map((o) => [o.id, o.title]));
  return {
    headline:
      solved === total
        ? "Great work — you completed every objective!"
        : "Nice progress — you worked through the lesson.",
    scoreLine: `You solved ${solved} of ${total} objectives, on the first try for ${firstTry.length}.`,
    strengths: firstTry.length
      ? firstTry.map((r) => `Nailed "${byId.get(r.objectiveId)}" on the first attempt.`)
      : ["You stuck with each question until you got it right."],
    focusAreas: struggled.length
      ? struggled.map(
          (r) => `"${byId.get(r.objectiveId)}" took ${r.attempts} attempts — worth another review.`,
        )
      : ["No major weak spots — consider a harder pass on the material."],
    studyTips: [
      "Re-read the sections tied to any objective that took more than one attempt.",
      "Try to explain each objective out loud in one sentence, without looking.",
      "Come back in a day and retake the lesson to check retention (spaced repetition).",
    ],
  };
}
