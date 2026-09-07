// The HITL wire contract between the LangGraph agent and the React UI.
//
// Interrupt payloads flow server -> client (what to render / ask the human).
// Resume payloads flow client -> server (the human's decision).
//
// Crucially, the public MCQ that reaches the client NEVER contains the correct
// option id or the explanation until the learner has answered correctly — so
// the answer cannot leak, even to the tutor chat.

import type { LearningObjective, LessonPlan, MCQ } from "./types";

export type PublicMCQ = Omit<MCQ, "correctOptionId" | "explanation">;

export type LessonInterrupt =
  | { kind: "approve_plan"; plan: LessonPlan }
  | {
      kind: "question";
      mcq: PublicMCQ;
      objective: LearningObjective;
      objectiveNumber: number;
      objectiveTotal: number;
      attempts: number;
      lastWrongOptionId: string | null;
    }
  | {
      kind: "reveal_correct";
      objective: LearningObjective;
      correctOptionId: string;
      explanation: string;
    };

export type LessonResume =
  | { action: "approve" }
  | { action: "revise"; plan: LessonPlan }
  | { action: "answer"; optionId: string }
  | { action: "skip" }
  | { action: "continue" };

export function toPublicMCQ(mcq: MCQ): PublicMCQ {
  const { correctOptionId: _c, explanation: _e, ...rest } = mcq;
  return rest;
}
