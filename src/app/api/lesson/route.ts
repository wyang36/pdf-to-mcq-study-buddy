import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Command, lessonGraph } from "@/agent/graph";
import type { LessonInterrupt } from "@/lib/protocol";
import { firstIssue, lessonRequestSchema } from "./schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Client-safe projection of the graph state — never includes the live MCQ's
 *  correct option or explanation (those only travel inside a reveal interrupt). */
function clientState(values: Record<string, unknown>) {
  return {
    phase: values.phase ?? "idle",
    documentTitle: values.documentTitle ?? "",
    plan: values.plan ?? null,
    currentObjectiveIndex: values.currentObjectiveIndex ?? 0,
    results: values.results ?? [],
    summary: values.summary ?? null,
    statusMessage: values.statusMessage ?? "",
  };
}

async function readSnapshot(threadId: string) {
  const config = { configurable: { thread_id: threadId } };
  const snapshot = await lessonGraph.getState(config);
  const interrupts = snapshot.tasks.flatMap((t) => t.interrupts ?? []);
  const pending =
    interrupts.length > 0 ? (interrupts[0].value as LessonInterrupt) : null;
  const done = (snapshot.next?.length ?? 0) === 0;
  return {
    threadId,
    state: clientState(snapshot.values as Record<string, unknown>),
    interrupt: pending,
    done,
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Parse before the graph sees any of it: nodes index into plan.objectives and
  // compare optionId against the answer key, so a malformed body should fail
  // here with a 400 rather than deep inside a node.
  const parsed = lessonRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = firstIssue(parsed.error);
    // Well-formed request, unusable document: the old handler answered 422 for
    // this case and the UI surfaces it differently from a protocol error.
    const status = message.includes("too short to build a lesson") ? 422 : 400;
    return NextResponse.json({ error: message }, { status });
  }
  const data = parsed.data;

  try {
    if (data.action === "start") {
      const threadId = randomUUID();
      const config = { configurable: { thread_id: threadId } };
      await lessonGraph.invoke(
        {
          documentTitle: data.documentTitle,
          sourceText: data.sourceText,
          phase: "planning",
        },
        config,
      );
      return NextResponse.json(await readSnapshot(threadId));
    }

    const config = { configurable: { thread_id: data.threadId } };
    await lessonGraph.invoke(new Command({ resume: data.resume }), config);
    return NextResponse.json(await readSnapshot(data.threadId));
  } catch (err) {
    console.error("[/api/lesson] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
