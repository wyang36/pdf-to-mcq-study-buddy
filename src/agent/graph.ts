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

import {
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import type { ObjectiveResult } from "@/lib/types";
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

// --- Nodes ------------------------------------------------------------------

async function planNode(
  state: LessonGraphState,
): Promise<Partial<LessonGraphState>> {
  const plan = await generatePlan(state.documentTitle, state.sourceText);
  return {
    plan,
    phase: "awaiting_plan_approval",
    statusMessage: "Draft lesson plan ready for your review.",
  };
}

async function approvePlanNode(
  state: LessonGraphState,
): Promise<Partial<LessonGraphState>> {
  const payload: LessonInterrupt = { kind: "approve_plan", plan: state.plan! };
  const decision = interrupt(payload) as LessonResume;

  const plan =
    decision.action === "revise" && decision.plan ? decision.plan : state.plan!;

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
): Promise<Partial<LessonGraphState>> {
  const objective = state.plan!.objectives[state.currentObjectiveIndex];
  const mcq = await generateMCQ(objective, state.sourceText, state.askedQuestions);
  return {
    currentMCQ: mcq,
    askedQuestions: [...state.askedQuestions, mcq.question],
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
