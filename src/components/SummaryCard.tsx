"use client";

import type { LessonPlan, LessonSummary, ObjectiveResult } from "@/lib/types";

export function SummaryCard({
  summary,
  plan,
  results,
  onRestart,
}: {
  summary: LessonSummary;
  plan: LessonPlan;
  results: ObjectiveResult[];
  onRestart: () => void;
}) {
  const byId = new Map(plan.objectives.map((o) => [o.id, o]));

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="text-4xl">🏁</div>
      <h2 className="mt-2 text-2xl font-semibold text-gray-900">
        {summary.headline}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{summary.scoreLine}</p>

      {/* per-objective breakdown */}
      <div className="mt-5 space-y-2">
        {results.map((r) => {
          const o = byId.get(r.objectiveId);
          return (
            <div
              key={r.objectiveId}
              className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"
            >
              <span className="text-gray-800">{o?.title ?? r.objectiveId}</span>
              <span
                className={
                  r.solved ? "text-emerald-600" : "text-gray-400"
                }
              >
                {r.solved ? `Solved · ${r.attempts} attempt${r.attempts === 1 ? "" : "s"}` : "Skipped"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Section title="Strengths" items={summary.strengths} tone="emerald" />
        <Section title="Focus areas" items={summary.focusAreas} tone="amber" />
      </div>

      <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
        <h3 className="text-sm font-semibold text-indigo-800">📚 Study tips</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-indigo-900">
          {summary.studyTips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onRestart}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Start a new lesson
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "emerald" | "amber";
}) {
  const color =
    tone === "emerald" ? "text-emerald-800" : "text-amber-800";
  return (
    <div>
      <h3 className={`text-sm font-semibold ${color}`}>{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
        {items.length ? items.map((it, i) => <li key={i}>{it}</li>) : <li>—</li>}
      </ul>
    </div>
  );
}
