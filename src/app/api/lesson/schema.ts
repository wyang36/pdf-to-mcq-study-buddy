// Request schemas for /api/lesson.
//
// The graph trusts its inputs — nodes index into `plan.objectives`, compare
// `optionId` against the answer key, and assume `resume.action` is one of the
// five known verbs. Parsing at the edge keeps a malformed body a 400 here
// instead of an exception three nodes deep.
//
// Kept out of lib/protocol.ts on purpose: that module is imported by client
// components, and these schemas would drag zod into the browser bundle.

import { z } from "zod";
import type { LessonResume } from "@/lib/protocol";

const difficultySchema = z.enum(["beginner", "intermediate", "advanced"]);

const lessonPlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  overallDifficulty: difficultySchema,
  objectives: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        difficulty: difficultySchema,
      }),
    )
    .min(1),
});

const resumeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("revise"), plan: lessonPlanSchema }),
  z.object({ action: z.literal("answer"), optionId: z.string().min(1) }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("continue") }),
]);

export const startRequestSchema = z.object({
  action: z.literal("start"),
  documentTitle: z.string().default(""),
  // The graph cannot build a lesson from a stub; the old handler enforced this
  // with a bare length check after coercing whatever arrived to a string.
  sourceText: z
    .string()
    .refine((t) => t.trim().length >= 40, {
      message: "Extracted document text is too short to build a lesson.",
    }),
});

export const resumeRequestSchema = z.object({
  action: z.literal("resume"),
  threadId: z.string().min(1, "threadId is required to resume"),
  resume: resumeSchema,
});

export const lessonRequestSchema = z.discriminatedUnion("action", [
  startRequestSchema,
  resumeRequestSchema,
]);

export type StartRequest = z.infer<typeof startRequestSchema>;
export type ResumeRequest = z.infer<typeof resumeRequestSchema>;

// The parsed resume payload is structurally the wire contract the graph awaits.
export type ParsedResume = z.infer<typeof resumeSchema> & LessonResume;

/** First error message from a failed parse, for the 400 body. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid request body";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
