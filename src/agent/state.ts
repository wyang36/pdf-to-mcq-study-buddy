// LangGraph state channels for the lesson agent.
import { Annotation } from "@langchain/langgraph";
import type {
  LessonPhase,
  LessonPlan,
  LessonSummary,
  MCQ,
  ObjectiveResult,
} from "@/lib/types";

export const LessonAnnotation = Annotation.Root({
  phase: Annotation<LessonPhase>({
    reducer: (_prev, next) => next,
    default: () => "idle",
  }),
  documentTitle: Annotation<string>({
    reducer: (_p, n) => n,
    default: () => "",
  }),
  sourceText: Annotation<string>({
    reducer: (_p, n) => n,
    default: () => "",
  }),
  plan: Annotation<LessonPlan | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  currentObjectiveIndex: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  currentMCQ: Annotation<MCQ | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  /** Questions already asked (per objective) so we don't repeat on new-question. */
  askedQuestions: Annotation<string[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  /** Attempts on the current question (retries loop back through edges). */
  currentAttempts: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  /** Last incorrect option id, surfaced to the UI on a retry. */
  lastWrongOptionId: Annotation<string | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  /** Transient routing hint set by ask_question, read by conditional edges. */
  route: Annotation<"correct" | "retry" | "skip" | "">({
    reducer: (_p, n) => n,
    default: () => "",
  }),
  results: Annotation<ObjectiveResult[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  summary: Annotation<LessonSummary | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  statusMessage: Annotation<string>({
    reducer: (_p, n) => n,
    default: () => "",
  }),
});

export type LessonGraphState = typeof LessonAnnotation.State;
