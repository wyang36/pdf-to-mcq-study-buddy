// Shared types used across the LangGraph agent, the API routes, and the React UI.

export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface LearningObjective {
  id: string;
  title: string;
  /** One-sentence description of what the learner should be able to do. */
  description: string;
  difficulty: Difficulty;
}

export interface LessonPlan {
  title: string;
  summary: string;
  overallDifficulty: Difficulty;
  objectives: LearningObjective[];
}

export interface MCQOption {
  /** Stable id, e.g. "a", "b", "c", "d". */
  id: string;
  text: string;
}

export interface MCQ {
  objectiveId: string;
  question: string;
  options: MCQOption[];
  /** id of the correct option. Never sent to the tutor-chat readable context. */
  correctOptionId: string;
  /** Shown after a correct answer. */
  explanation: string;
  /** Shown after a wrong answer — nudges without revealing the answer. */
  hint: string;
}

/** Per-objective running score. */
export interface ObjectiveResult {
  objectiveId: string;
  attempts: number;
  solved: boolean;
}

export interface LessonSummary {
  headline: string;
  scoreLine: string;
  strengths: string[];
  focusAreas: string[];
  studyTips: string[];
}

/**
 * The full shared state of the lesson agent. This is what the LangGraph graph
 * carries between nodes and what the frontend renders. `phase` drives which
 * widget the UI shows.
 */
export type LessonPhase =
  | "idle"
  | "planning"
  | "awaiting_plan_approval"
  | "quizzing"
  | "summarizing"
  | "done";

export interface LessonState {
  phase: LessonPhase;
  documentTitle: string;
  /** Extracted PDF text (truncated for prompting). */
  sourceText: string;
  plan: LessonPlan | null;
  /** Index into plan.objectives of the objective currently being quizzed. */
  currentObjectiveIndex: number;
  /** The MCQ currently being presented (for the current objective). */
  currentMCQ: MCQ | null;
  results: ObjectiveResult[];
  summary: LessonSummary | null;
  /** Human-readable status line the UI can show while the agent works. */
  statusMessage: string;
}
