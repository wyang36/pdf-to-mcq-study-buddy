// The lesson agent as a LangGraph.js state machine.
//
// Flow:
//   make_plan -> approve_plan (HITL) -> generate_question -> ask_question (HITL)
//     ask_question --correct--> reveal (HITL) --> advance
//     ask_question --retry----> ask_question        (re-ask, show hint)
//     ask_question --skip-----> advance
//   advance --> generate_question (next objective) | summarize --> END
//
// Design rule: AT MOST ONE interrupt() per node. Retries are graph edges, not
// an in-node loop — this keeps checkpoint/resume behaviour rock solid.
//
// Server-only: the graph carries the answer key in its state, so importing it
// from a client component must fail the build, not leak the answers.

import "server-only";

import {
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { MCQ, ObjectiveResult } from "@/lib/types";
import type { LessonInterrupt, LessonResume } from "@/lib/protocol";
import { toPublicMCQ } from "@/lib/protocol";
import { generateMCQ, generatePlan, generateSummary } from "./llm";
import { LessonAnnotation, type LessonGraphState } from "./state";

function upsertResult(
  results: ObjectiveResult[],
  objectiveId: string,
  patch: Partial<ObjectiveResult>,
): ObjectiveResult[] {
  const next = results.slice();
  const idx = next.findIndex((r) => r.objectiveId === objectiveId);
  if (idx === -1) {
    next.push({ objectiveId, attempts: 0, solved: false, ...patch });
  } else {
    next[idx] = { ...next[idx], ...patch };
  }
  return next;
}

// --- Question prefetch ------------------------------------------------------
//
// Generating an MCQ is a 6-12s LLM round trip, and the old flow paid it *after*
// the learner clicked Continue, so every transition stalled. The learner spends
// far longer than that reading and answering, so we spend that idle time
// generating the NEXT objective's question in the background: by the time they
// advance, the promise has usually already resolved and the hand-off is instant.
//
// Keyed by thread so concurrent lessons never see each other's questions. The
// cache is in-memory and disposable — exactly like the MemorySaver checkpointer
// it sits beside — and a miss simply costs what the old code always cost.

const questionCache = new Map<string, Promise<MCQ>>();

function cacheKey(threadId: string, objectiveIndex: number): string {
  return `${threadId}::${objectiveIndex}`;
}

function threadIdOf(config?: LangGraphRunnableConfig): string {
  return String(config?.configurable?.thread_id ?? "");
}

/** Start generating a question now, without waiting for it. */
function prefetchQuestion(
  threadId: string,
  objectiveIndex: number,
  state: LessonGraphState,
  askedQuestions: string[],
): void {
  const objective = state.plan?.objectives[objectiveIndex];
  if (!threadId || !objective) return;
  const key = cacheKey(threadId, objectiveIndex);
  if (questionCache.has(key)) return;
  const pending = generateMCQ(objective, state.sourceText, askedQuestions).catch(
    (err) => {
      // Drop the failed promise so the awaiting node retries in the foreground.
      questionCache.delete(key);
      throw err;
    },
  );
  questionCache.set(key, pending);
}

/** Take the prefetched question if one is in flight, else generate it now. */
async function takeQuestion(
  threadId: string,
  objectiveIndex: number,
  state: LessonGraphState,
): Promise<MCQ> {
  const objective = state.plan!.objectives[objectiveIndex];
  const key = cacheKey(threadId, objectiveIndex);
  const pending = questionCache.get(key);
  questionCache.delete(key);
  if (pending) {
    try {
      return await pending;
    } catch {
      // fall through to a fresh attempt
    }
  }
  return generateMCQ(objective, state.sourceText, state.askedQuestions);
}

/** Throw away every question queued for a thread (its plan just changed). */
function clearPrefetched(threadId: string): void {
  for (const key of questionCache.keys()) {
    if (key.startsWith(`${threadId}::`)) questionCache.delete(key);
  }
}

// --- Nodes ------------------------------------------------------------------

async function planNode(
  state: LessonGraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<LessonGraphState>> {
  const plan = await generatePlan(state.documentTitle, state.sourceText);
  // The plan now waits on a human, which is free time: start objective 1's
  // question so approving the plan doesn't cost a second round trip.
  prefetchQuestion(threadIdOf(config), 0, { ...state, plan }, []);
  return {
    plan,
    phase: "awaiting_plan_approval",
    statusMessage: "Draft lesson plan ready for your review.",
  };
}

async function approvePlanNode(
  state: LessonGraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<LessonGraphState>> {
  const payload: LessonInterrupt = { kind: "approve_plan", plan: state.plan! };
  const decision = interrupt(payload) as LessonResume;

  const revised = decision.action === "revise" && Boolean(decision.plan);
  const plan = revised ? decision.plan! : state.plan!;
  // The learner edited the objectives, so anything queued against the old plan
  // is stale — throw it away rather than quiz them on a deleted objective.
  if (revised) clearPrefetched(threadIdOf(config));

  return {
    plan,
    phase: "quizzing",
    currentObjectiveIndex: 0,
    results: plan.objectives.map((o) => ({
      objectiveId: o.id,
      attempts: 0,
      solved: false,
    })),
    askedQuestions: [],
    statusMessage: "Plan approved. Let's begin the quiz.",
  };
}

async function generateQuestionNode(
  state: LessonGraphState,
  config?: LangGraphRunnableConfig,
): Promise<Partial<LessonGraphState>> {
  const objective = state.plan!.objectives[state.currentObjectiveIndex];
  const threadId = threadIdOf(config);
  const mcq = await takeQuestion(threadId, state.currentObjectiveIndex, state);
  const askedQuestions = [...state.askedQuestions, mcq.question];
  // The learner is about to spend time on this question — use it to build the
  // next one, passing the updated asked-list so it can't repeat itself.
  prefetchQuestion(
    threadId,
    state.currentObjectiveIndex + 1,
    state,
    askedQuestions,
  );
  return {
    currentMCQ: mcq,
    askedQuestions,
    currentAttempts: 0,
    lastWrongOptionId: null,
    route: "",
    phase: "quizzing",
    statusMessage: `Objective ${state.currentObjectiveIndex + 1}: ${objective.title}`,
  };
}

/** Presents the current MCQ and pauses for the learner's choice (one interrupt). */
async function askQuestionNode(
  state: LessonGraphState,
): Promise<Partial<LessonGraphState>> {
  const mcq = state.currentMCQ!;
  const objective = state.plan!.objectives[state.currentObjectiveIndex];

  const payload: LessonInterrupt = {
    kind: "question",
    mcq: toPublicMCQ(mcq),
    objective,
    objectiveNumber: state.currentObjectiveIndex + 1,
    objectiveTotal: state.plan!.objectives.length,
    attempts: state.currentAttempts,
    lastWrongOptionId: state.lastWrongOptionId,
  };
  const res = interrupt(payload) as LessonResume;
  const attempts = state.currentAttempts + 1;

  if (res.action === "skip") {
    return {
      route: "skip",
      currentAttempts: attempts,
      results: upsertResult(state.results, objective.id, {
        attempts: state.currentAttempts,
        solved: false,
      }),
    };
  }

  if (res.action === "answer" && res.optionId === mcq.correctOptionId) {
    return {
      route: "correct",
      currentAttempts: attempts,
      results: upsertResult(state.results, objective.id, {
        attempts,
        solved: true,
      }),
    };
  }

  // Wrong answer — loop back to ask again (free retry), remembering the miss.
  return {
    route: "retry",
    currentAttempts: attempts,
    lastWrongOptionId: res.action === "answer" ? res.optionId : state.lastWrongOptionId,
  };
}

/** After a correct answer: reveal explanation + green highlight, wait to continue. */
async function revealNode(
  state: LessonGraphState,
): Promise<Partial<LessonGraphState>> {
  const mcq = state.currentMCQ!;
  const objective = state.plan!.objectives[state.currentObjectiveIndex];
  const payload: LessonInterrupt = {
    kind: "reveal_correct",
    objective,
    correctOptionId: mcq.correctOptionId,
    explanation: mcq.explanation,
  };
  interrupt(payload);
  return { statusMessage: `Solved: ${objective.title}` };
}

/** Moves to the next objective (or on to the summary). No interrupt. */
async function advanceNode(
  state: LessonGraphState,
): Promise<Partial<LessonGraphState>> {
  return {
    currentObjectiveIndex: state.currentObjectiveIndex + 1,
    currentMCQ: null,
    currentAttempts: 0,
    lastWrongOptionId: null,
    route: "",
  };
}

async function summarizeNode(
  state: LessonGraphState,
): Promise<Partial<LessonGraphState>> {
  const summary = await generateSummary(state.plan!, state.results);
  return {
    summary,
    phase: "done",
    currentMCQ: null,
    statusMessage: "Lesson complete.",
  };
}

// --- Routing ----------------------------------------------------------------

function afterAsk(
  state: LessonGraphState,
): "reveal" | "ask_question" | "advance" {
  if (state.route === "correct") return "reveal";
  if (state.route === "skip") return "advance";
  return "ask_question"; // retry
}

function afterAdvance(
  state: LessonGraphState,
): "generate_question" | "summarize" {
  return state.currentObjectiveIndex >= state.plan!.objectives.length
    ? "summarize"
    : "generate_question";
}

// --- Compile (singleton so the in-memory checkpointer persists) -------------

function buildGraph() {
  return new StateGraph(LessonAnnotation)
    .addNode("make_plan", planNode)
    .addNode("approve_plan", approvePlanNode)
    .addNode("generate_question", generateQuestionNode)
    .addNode("ask_question", askQuestionNode)
    .addNode("reveal", revealNode)
    .addNode("advance", advanceNode)
    .addNode("summarize", summarizeNode)
    .addEdge(START, "make_plan")
    .addEdge("make_plan", "approve_plan")
    .addEdge("approve_plan", "generate_question")
    .addEdge("generate_question", "ask_question")
    .addConditionalEdges("ask_question", afterAsk, [
      "reveal",
      "ask_question",
      "advance",
    ])
    .addEdge("reveal", "advance")
    .addConditionalEdges("advance", afterAdvance, [
      "generate_question",
      "summarize",
    ])
    .addEdge("summarize", END)
    .compile({ checkpointer: new MemorySaver() });
}

type CompiledLessonGraph = ReturnType<typeof buildGraph>;

const globalForGraph = globalThis as unknown as {
  __lessonGraph?: CompiledLessonGraph;
};

export const lessonGraph: CompiledLessonGraph =
  globalForGraph.__lessonGraph ?? buildGraph();

if (process.env.NODE_ENV !== "production") {
  globalForGraph.__lessonGraph = lessonGraph;
}

export { Command };
export type { LessonGraphState };
