// Provider-configurable LLM layer for the lesson agent.
//
// It builds an ordered *fallback chain* of models and tries them in turn for
// every generation (plan / MCQ / summary). If a model errors (bad key, rate
// limit, unsupported structured output) the next one is tried, and if the whole
// chain is exhausted it falls back to a deterministic offline mock — so the app
// always produces a usable lesson.
//
// Default chain (auto-detected from whichever keys are present):
//   Gemini  →  OpenRouter (free)  →  Vercel AI Gateway  →  Anthropic  →  OpenAI  →  mock
//
// Override with LLM_PROVIDER (pins a single primary) and LLM_FALLBACK_PROVIDER.
//
// This module holds API keys and provider clients, so it must never reach the
// browser. "server-only" makes that a build error rather than a convention: any
// client component that imports it as a value (a type-only import is erased and
// stays fine) fails the build instead of silently shipping this to the client.

import "server-only";

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

export type Provider =
  | "gemini"
  | "openrouter"
  | "vercel"
  | "anthropic"
  | "openai"
  | "mock";

// Order matters: the keyless-cheapest options first, then direct provider keys.
const REAL_PROVIDERS: Exclude<Provider, "mock">[] = [
  "gemini",
  "openrouter",
  "vercel",
  "anthropic",
  "openai",
];

const DEFAULT_MODELS: Record<Exclude<Provider, "mock">, string> = {
  gemini: "gemini-3.6-flash",
  // Free models get retired from OpenRouter regularly (this slot previously held
  // llama-3.3-70b:free, which is now paid-only), so prefer one that is currently
  // free AND reliably emits valid JSON for our prompts. "openrouter/free" is the
  // rot-proof alternative — it auto-routes across whatever is free today — but it
  // is slower and less predictable, so we pin a specific model here.
  openrouter: "nvidia/nemotron-3-super-120b-a12b:free",
  // The gateway fronts many providers under "vendor/model" slugs. Defaulting to
  // the same model family as the primary keeps question quality consistent when
  // this backup takes over, while drawing on Vercel's quota rather than the
  // Gemini free tier that just ran out. Full list: https://ai-gateway.vercel.sh/v1/models
  vercel: "google/gemini-3-flash",
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o",
};

function keyFor(provider: Provider): string | undefined {
  switch (provider) {
    case "gemini":
      return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY;
    case "vercel":
      // AI_GATEWAY_API_KEY is the name the Vercel AI SDK itself looks for, and
      // it is injected automatically on Vercel deployments.
      return (
        process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY_API_KEY
      );
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    default:
      return undefined;
  }
}

function isRealProvider(v: string): v is Exclude<Provider, "mock"> {
  return (REAL_PROVIDERS as string[]).includes(v);
}

/** Ordered list of providers to try (excludes mock). */
export function resolveProviderChain(): Exclude<Provider, "mock">[] {
  const explicit = (process.env.LLM_PROVIDER || "").toLowerCase();

  if (explicit === "mock") return [];

  if (isRealProvider(explicit)) {
    const chain: Exclude<Provider, "mock">[] = [explicit];
    const fallback = (process.env.LLM_FALLBACK_PROVIDER || "").toLowerCase();
    if (isRealProvider(fallback) && fallback !== explicit) chain.push(fallback);
    return chain.filter((p) => keyFor(p));
  }

  // Auto: default priority order, filtered to providers that have a key.
  return REAL_PROVIDERS.filter((p) => keyFor(p));
}

/** The provider that will actually be used first (for display), or "mock". */
export function resolveProvider(): Provider {
  return resolveProviderChain()[0] ?? "mock";
}

/** Human-readable label of the active chain, e.g. "gemini → openrouter". */
export function providerChainLabel(): string {
  const chain = resolveProviderChain();
  return chain.length ? chain.join(" → ") : "mock";
}

export function hasRealLLM(): boolean {
  return resolveProviderChain().length > 0;
}

// Lazy-load the heavy model libs so mock mode stays light.
async function buildModel(
  provider: Exclude<Provider, "mock">,
): Promise<BaseChatModel | null> {
  const apiKey = keyFor(provider);
  if (!apiKey) return null;

  switch (provider) {
    case "gemini": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({
        model: process.env.GEMINI_MODEL || DEFAULT_MODELS.gemini,
        temperature: 0.3,
        // Default is 6 retries with backoff. A free-tier daily quota is not
        // going to clear in the next 30 seconds, and retrying it turned a
        // failover into a 100s stall, so give up fast and let the chain work.
        maxRetries: 1,
        apiKey,
      });
    }
    case "openrouter": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODELS.openrouter,
        temperature: 0.3,
        maxRetries: 1,
        apiKey,
        configuration: {
          baseURL: "https://openrouter.ai/api/v1",
          defaultHeaders: { "X-Title": "PDF Lesson Agent" },
        },
      });
    }
    case "vercel": {
      // The gateway speaks the OpenAI wire format, so the OpenAI client works
      // against it unchanged — same trick as the OpenRouter branch above.
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({
        model:
          process.env.AI_GATEWAY_MODEL ||
          process.env.VERCEL_AI_GATEWAY_MODEL ||
          DEFAULT_MODELS.vercel,
        temperature: 0.3,
        maxRetries: 1,
        apiKey,
        configuration: { baseURL: "https://ai-gateway.vercel.sh/v1" },
      });
    }
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic,
        temperature: 0.3,
        maxRetries: 2,
        apiKey,
      });
    }
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({
        model: process.env.OPENAI_MODEL || DEFAULT_MODELS.openai,
        temperature: 0.3,
        maxRetries: 2,
        apiKey,
      });
    }
  }
}

/** Build every model in the fallback chain, in order. */
async function getCandidateModels(): Promise<BaseChatModel[]> {
  const models: BaseChatModel[] = [];
  for (const provider of resolveProviderChain()) {
    const model = await buildModel(provider);
    if (model) models.push(model);
  }
  return models;
}

/** Every model in the chain, in order — used by the CopilotKit tutor chat so it
 *  degrades through the same providers the lesson does instead of erroring in
 *  the sidebar the moment the primary hits a rate limit. */
export async function createChatModels(): Promise<BaseChatModel[]> {
  return getCandidateModels();
}

// --- Structured generation with chain fallback ------------------------------
//
// We deliberately DON'T use model.withStructuredOutput(): its JSON-Schema (with
// $ref for reused enums) is rejected by Gemini's response_schema, and many free
// OpenRouter models don't support tool/function calling at all. Prompting for
// JSON and validating with zod ourselves is the most provider-agnostic path.

/** Pull a JSON object out of a model response (handles ```json fences / prose). */
function extractJson(text: string): unknown {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

/** Coerce an AIMessage's content (string | parts[]) to plain text. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === "string" ? c : (c as { text?: string })?.text ?? "",
      )
      .join("");
  }
  return String(content ?? "");
}

async function runStructured<T>(
  schema: z.ZodType<T>,
  name: string,
  system: string,
  user: string,
  shape: string,
): Promise<T | null> {
  const jsonUser = `${user}

Respond with ONLY a single JSON object — no markdown, no code fences, no commentary — matching EXACTLY this shape:
${shape}`;

  const models = await getCandidateModels();
  for (const model of models) {
    try {
      const res = await model.invoke([
        { role: "system", content: system },
        { role: "user", content: jsonUser },
      ]);
      const parsed = extractJson(messageText(res.content));
      return schema.parse(parsed);
    } catch (err) {
      console.error(
        `[llm] structured "${name}" failed on a model, trying next:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}

// Shape hints handed to the model (kept in sync with the zod schemas below).
const PLAN_SHAPE = `{
  "title": string,
  "summary": string,
  "overallDifficulty": "beginner" | "intermediate" | "advanced",
  "objectives": [ { "title": string, "description": string, "difficulty": "beginner" | "intermediate" | "advanced" } ]  // 3 to 5 items, foundational -> advanced
}`;

const MCQ_SHAPE = `{
  "question": string,
  "options": [ {"id":"a","text":string}, {"id":"b","text":string}, {"id":"c","text":string}, {"id":"d","text":string} ],  // exactly 4
  "correctOptionId": "a" | "b" | "c" | "d",
  "explanation": string,  // shown after a CORRECT answer
  "hint": string          // shown after a WRONG answer; must NOT reveal the correct option
}`;

const SUMMARY_SHAPE = `{
  "headline": string,
  "scoreLine": string,
  "strengths": string[],
  "focusAreas": string[],
  "studyTips": string[]  // 2 to 4 concrete tips
}`;

// --- Zod schemas ------------------------------------------------------------

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
  const raw = await runStructured(
    planSchema,
    "lesson_plan",
    PLAN_SYSTEM,
    planUserPrompt(title, sourceText),
    PLAN_SHAPE,
  );
  if (raw) {
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
  }
  return mockPlan(title, sourceText);
}

const OPTION_IDS = ["a", "b", "c", "d"] as const;

/**
 * Deal the options into a random order and re-letter them.
 *
 * Models have a strong positional bias: asked to write an MCQ, they overwhelmingly
 * put the correct answer first and mark it "a". Measured on this prompt, "a" was
 * correct 3 times out of 4 — a learner who always picks the first option scores far
 * better than chance. Shuffling server-side fixes that for every provider at once,
 * and costs nothing, whereas asking the model to vary the position is unreliable.
 */
function shuffleOptions(
  options: MCQ["options"],
  correctOptionId: string,
): { options: MCQ["options"]; correctOptionId: string } {
  const correctText = options.find((o) => o.id === correctOptionId)?.text;
  const texts = options.map((o) => o.text);
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }
  const shuffled = texts.map((text, i) => ({ id: OPTION_IDS[i], text }));
  const moved = shuffled.find((o) => o.text === correctText);
  // If the correct text somehow went missing, keep the model's own ordering
  // rather than silently mis-marking the answer.
  if (!moved) return { options, correctOptionId };
  return { options: shuffled, correctOptionId: moved.id };
}

export async function generateMCQ(
  objective: LearningObjective,
  sourceText: string,
  avoidQuestions: string[],
): Promise<MCQ> {
  const raw = await runStructured(
    mcqSchema,
    "mcq",
    MCQ_SYSTEM,
    mcqUserPrompt(
      objective.title,
      objective.description,
      sourceText,
      avoidQuestions,
    ),
    MCQ_SHAPE,
  );
  if (raw) {
    const dealt = shuffleOptions(raw.options, raw.correctOptionId);
    return {
      objectiveId: objective.id,
      question: raw.question,
      options: dealt.options,
      correctOptionId: dealt.correctOptionId,
      explanation: raw.explanation,
      hint: raw.hint,
    };
  }
  return mockMCQ(objective, sourceText, avoidQuestions.length);
}

export async function generateSummary(
  plan: LessonPlan,
  results: ObjectiveResult[],
): Promise<LessonSummary> {
  const raw = await runStructured(
    summarySchema,
    "summary",
    SUMMARY_SYSTEM,
    summaryUserPrompt(JSON.stringify(plan), JSON.stringify(results)),
    SUMMARY_SHAPE,
  );
  return raw ?? mockSummary(plan, results);
}

// --- Mock implementations (deterministic, no network) -----------------------

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 320);
}

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
  const objectives: LearningObjective[] = (
    kws.length ? kws.slice(0, 3) : ["core concepts", "key details", "applications"]
  ).map((kw, i) => ({
    id: `obj-${i + 1}`,
    title: `Understand ${kw}`,
    description: `Explain the role of ${kw} as presented in ${subject}.`,
    difficulty: diffs[Math.min(i, diffs.length - 1)],
  }));
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
    sents[(askedCount * 3) % Math.max(sents.length, 1)] || objective.description;
  const correct = fact.length > 140 ? fact.slice(0, 137) + "…" : fact;
  const distractors = [
    "It is explicitly described as irrelevant to the topic.",
    "The document states the opposite of this.",
    "This is never mentioned anywhere in the document.",
  ];
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
