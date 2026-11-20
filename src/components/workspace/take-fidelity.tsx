"use client";

import { Gauge, Palette, Wand2 } from "lucide-react";
import { useState } from "react";
import useSWR, { mutate as refresh } from "swr";
import { api, errorMessage, fetcher } from "@/lib/api";
import type { FidelityReport, GradeReport } from "@/server/director/fidelity";
import { Button, Spinner, cn } from "@/ui";

export type DeliveredTake = { id: string; clip: number; snapshotId: string | null; result: { assetId: string; url: string } };

type Fidelity = {
  id: string; state: "queued" | "running" | "succeeded" | "failed"; score: number | null;
  report: FidelityReport | null; error: { message: string } | null;
};
type Grade = { id: string; assetId: string; url: string; strength: number; report: GradeReport };
type Review = { fidelity: Fidelity | null; grade: Grade | null };

const panel = "rounded-2xl border border-border-default bg-surface-secondary p-4";
const scoring = (fidelity?: Fidelity | null) => fidelity?.state === "queued" || fidelity?.state === "running";
const round = (value: number) => Number(value.toFixed(value >= 10 ? 1 : 3));
const topic = (value: string) => value.replaceAll("-", " ");

/** The fix request sent to the Director: the failed numbers and rules, in plain words. */
export function fixMessage(clip: number, report: FidelityReport) {
  const numbers = report.numeric.filter(({ pass }) => !pass)
    .map(({ label, target, actual, tolerance, metric }) => metric === "palette"
      ? `${label} is ${round(actual)}; the style allows ${tolerance}`
      : `${label} is ${round(actual)}; the style is ${round(target)} (${tolerance})`);
  const rules = (report.judged ?? []).filter(({ pass }) => !pass).map(({ index, topic: name, note }) => `rule ${index + 1} (${topic(name)}): ${note}`);
  return [
    `The delivered take for clip ${clip + 1} missed its style. Revise the pack so the next render matches it.`,
    numbers.length ? `Measured misses: ${numbers.join("; ")}.` : "",
    rules.length ? `Signature rules missed: ${rules.join("; ")}.` : "",
    "Keep everything that already matches.",
  ].filter(Boolean).join(" ").slice(0, 3500);
}

function TakeCard({ take, projectId, current }: { take: DeliveredTake; projectId: string; current: boolean }) {
  const key = `/api/director/renders/${take.id}/fidelity`;
  const { data, error, mutate } = useSWR<Review>(key, fetcher, { refreshInterval: (value) => (scoring(value?.fidelity) ? 1500 : 0) });
  const [busy, setBusy] = useState<"" | "score" | "grade" | "fix">("");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [showGraded, setShowGraded] = useState(false);
  const fidelity = data?.fidelity ?? null;
  const report = fidelity?.state === "succeeded" ? fidelity.report : null;
  const misses = report ? [
    ...report.numeric.filter(({ pass }) => !pass).map((check) => ({ key: check.metric, title: check.label,
      detail: check.metric === "palette" ? `${round(check.actual)} · allowed ${check.tolerance}` : `${round(check.actual)} vs ${round(check.target)} · ${check.tolerance}` })),
    ...(report.judged ?? []).filter(({ pass }) => !pass).map((rule) => ({ key: `rule-${rule.index}`, title: `Rule ${rule.index + 1} · ${topic(rule.topic)}`, detail: rule.note })),
  ] : [];
  const grade = data?.grade ?? null;

  async function act(kind: "score" | "grade" | "fix") {
    setBusy(kind);
    setProblem("");
    setNotice("");
    try {
      if (kind === "score") await api(key, { method: "POST", body: {} });
      if (kind === "grade") {
        await api(`/api/director/renders/${take.id}/grade`, { method: "POST", body: {} });
        setShowGraded(true);
      }
      if (kind === "fix" && report) {
        await api(`/api/director/projects/${projectId}/chat`, { method: "POST", body: { message: fixMessage(take.clip, report) } });
        setNotice("Sent to the Director. A revised pack appears here when it replies. Render it after you review the new quote.");
        void refresh(`/api/director/projects/${projectId}`);
      }
      await mutate();
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy("");
    }
  }

  return (
    <li className={cn(panel, "flex min-w-0 flex-col gap-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-bold">Clip {take.clip + 1} take{current ? "" : " · earlier pack"}</h4>
        {fidelity?.state === "succeeded" && fidelity.score !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-tertiary px-2.5 py-1.5 text-sm font-bold" aria-label={`Fidelity score ${fidelity.score} out of 100`}>
            <Gauge size={15} aria-hidden /> {fidelity.score}/100
          </span>
        )}
      </div>

      {grade && (
        <div className="flex gap-2" role="group" aria-label="Compare takes">
          {[false, true].map((graded) => (
            <button key={String(graded)} type="button" aria-pressed={showGraded === graded} onClick={() => setShowGraded(graded)}
              className={cn("ooo-control min-h-11 rounded-lg border border-border-default px-3 text-xs font-semibold", showGraded === graded ? "bg-surface-elevated" : "bg-surface-secondary hover:bg-surface-tertiary")}>
              {graded ? "Graded" : "Original"}
            </button>
          ))}
        </div>
      )}
      <video key={showGraded && grade ? grade.url : take.result.url} src={showGraded && grade ? grade.url : take.result.url} controls playsInline preload="metadata"
        className="aspect-video w-full rounded-lg bg-surface-sunken object-contain" aria-label={`Clip ${take.clip + 1} ${showGraded && grade ? "graded" : "original"} take`} />
      {grade?.report.paletteDistance && (
        <p className="text-xs text-text-secondary">
          Grade at strength {grade.strength}: palette distance {round(grade.report.paletteDistance.before)} → {round(grade.report.paletteDistance.after)}
          {grade.report.grainAdded ? ` · grain added (${grade.report.grainAdded})` : ""}.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-danger">{errorMessage(error)}</p>}
      {!data && !error && <p role="status" className="text-sm text-text-secondary">Loading the score…</p>}
      {data && !fidelity && <p className="text-sm text-text-secondary">This take has not been scored.</p>}
      {scoring(fidelity) && <p role="status" className="flex items-center gap-2 text-sm"><Spinner /> Measuring the take against the style…</p>}
      {fidelity?.state === "failed" && <p role="alert" className="text-sm text-danger">{fidelity.error?.message}</p>}
      {report && (
        <div className="flex flex-col gap-2 text-sm">
          {report.judge?.fixture && <p className="text-xs text-text-secondary">Fixture mode: the rule review is a placeholder, not a visual judgement.</p>}
          {report.judgeError && <p className="text-xs text-text-secondary">The rule review was skipped: {report.judgeError} The score uses measurements only.</p>}
          {misses.length ? (
            <>
              <p className="font-semibold">{misses.length} {misses.length === 1 ? "miss" : "misses"}</p>
              <ul className="divide-y divide-border-default border-y border-border-default">
                {misses.map((miss) => <li key={miss.key} className="py-2"><span className="font-semibold">{miss.title}</span><p className="text-xs leading-5 text-text-secondary">{miss.detail}</p></li>)}
              </ul>
            </>
          ) : <p className="font-semibold">Every measured check and signature rule passed.</p>}
          {!!report.skipped.length && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-text-secondary">Not compared ({report.skipped.length})</summary>
              <ul className="mt-1 list-disc pl-5 text-xs leading-5 text-text-secondary">{report.skipped.map((item) => <li key={item.metric}>{item.label}: {item.reason}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {report && misses.length > 0 && (
          <Button variant="lime" size="md" disabled={!!busy} onClick={() => void act("fix")}><Wand2 size={15} aria-hidden /> {busy === "fix" ? "Sending…" : "Fix with Director"}</Button>
        )}
        <Button variant="outline" size="md" disabled={!!busy || scoring(fidelity)} onClick={() => void act("score")}>{busy === "score" ? "Queuing…" : fidelity ? "Score again" : "Score take"}</Button>
        <Button variant="outline" size="md" disabled={!!busy} onClick={() => void act("grade")}><Palette size={15} aria-hidden /> {busy === "grade" ? "Grading…" : grade ? "Grade again" : "Grade to style"}</Button>
      </div>
      <p role="status" className="text-xs text-text-secondary">{notice}</p>
      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
    </li>
  );
}

/** Delivered takes for a styled project, each with its fidelity score and post-grade. */
export function TakeFidelity({ projectId, packId, takes }: { projectId: string; packId: string; takes: DeliveredTake[] }) {
  if (!takes.length) return null;
  return (
    <section aria-labelledby="take-fidelity-title" className="flex min-w-0 flex-col gap-3 border-t border-border-default pt-4">
      <div>
        <h3 id="take-fidelity-title" className="text-lg font-bold">Delivered takes</h3>
        <p className="mt-1 text-sm leading-6 text-text-secondary">Each take is measured against the pinned style. Fixing a miss revises the pack; it never renders by itself.</p>
      </div>
      <ul className="grid min-w-0 gap-3 min-[1000px]:grid-cols-2">
        {takes.map((take) => <TakeCard key={take.id} take={take} projectId={projectId} current={take.snapshotId === packId} />)}
      </ul>
    </section>
  );
}
