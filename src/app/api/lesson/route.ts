import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Command, lessonGraph } from "@/agent/graph";
import type { LessonInterrupt, LessonResume } from "@/lib/protocol";

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

  const data = body as Record<string, unknown>;

  try {
    if (data.action === "start") {
      const documentTitle = String(data.documentTitle ?? "");
      const sourceText = String(data.sourceText ?? "");
      if (sourceText.trim().length < 40) {
        return NextResponse.json(
          { error: "Extracted document text is too short to build a lesson." },
          { status: 422 },
        );
      }
      const threadId = randomUUID();
      const config = { configurable: { thread_id: threadId } };
      await lessonGraph.invoke(
        { documentTitle, sourceText, phase: "planning" },
        config,
      );
      return NextResponse.json(await readSnapshot(threadId));
    }

    if (data.action === "resume") {
      const threadId = String(data.threadId ?? "");
      if (!threadId) {
        return NextResponse.json(
          { error: "threadId is required to resume" },
          { status: 400 },
        );
      }
      const resume = data.resume as LessonResume;
      const config = { configurable: { thread_id: threadId } };
      await lessonGraph.invoke(new Command({ resume }), config);
      return NextResponse.json(await readSnapshot(threadId));
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[/api/lesson] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
