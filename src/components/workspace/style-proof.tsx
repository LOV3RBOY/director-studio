"use client";

import { ArrowUpRight, Check, Clipboard, ScanLine } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { PackBody } from "@/server/director/compiler";
import type { Brief, StyleProfile } from "@/server/director/contracts";
import { Button, cn } from "@/ui";

type Pack = { id: string; version: number; body: PackBody };
type PinnedStyle = { id: string; styleId: string; title: string; version: number; profile: StyleProfile };

const seconds = (ms: number) => `${Number((ms / 1000).toFixed(3))}s`;
const topic = (value: string) => value.replaceAll("-", " ");
const panel = "rounded-2xl border border-border-default bg-surface-secondary p-4";

export function StyleProof({ pack, style, cast, reviewedAt, onReviewed }: {
  pack: Pack;
  style: PinnedStyle;
  cast: Brief["cast"];
  reviewedAt: number | null;
  onReviewed: (at: number) => void;
}) {
  const [clipIndex, setClipIndex] = useState(0);
  const [shotIndex, setShotIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const clips = pack.body.plan.clips;
  const clip = clips[clipIndex];
  const compiled = pack.body.clips[clipIndex];
  const shot = clip.shots[shotIndex];
  const rules = style.profile.rules;
  const linked = shot.styleRuleIndices ?? [];
  const cited = new Set(clips.flatMap((item) => item.shots.flatMap((row) => row.styleRuleIndices ?? [])));
  const uncited = rules.filter((rule, index) => rule.reuse === "signature" && rule.basis !== "unknown" && !cited.has(index));
  const hasSource = compiled.attachments.some((attachment) => attachment.assetId === style.profile.evidence.assetId);
  const missingCast = (cast ?? []).filter((member) => !compiled.attachments.some((attachment) => attachment.role === "identity" && member.assetIds.includes(attachment.assetId)));
  const details = [
    ["Start frame", shot.start], ["Action", shot.action], ["Camera", shot.movement], ["End frame", shot.end],
    ["Framing and reveal", shot.framing], ["Continuity", shot.continuity], ["Sound", shot.sound],
  ].filter(([, value]) => value);

  async function record() {
    setSaving(true);
    setProblem("");
    try {
      const result = await api<{ reviewedAt: number }>(`/api/director/packs/${pack.id}/review`, { method: "POST", body: {} });
      onReviewed(result.reviewedAt);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(compiled.prompt);
      setCopyStatus("Prompt copied.");
    } catch {
      setCopyStatus("Select the prompt text to copy it.");
    }
  }

  return (
    <section aria-labelledby="style-proof-title" className="ooo-panel flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="ooo-icon-tile"><ScanLine size={20} aria-hidden /></span>
          <div>
            <h2 id="style-proof-title" className="text-xl leading-tight font-bold tracking-tight">Style Proof</h2>
            <p className="mt-1 text-xs text-text-secondary">Pack v{pack.version} · {style.title} v{style.version}</p>
          </div>
        </div>
        {reviewedAt && <span role="status" className="inline-flex items-center gap-1.5 rounded-lg bg-surface-tertiary px-2.5 py-2 text-xs font-semibold"><Check size={15} aria-hidden /> Pack v{pack.version} reviewed</span>}
      </header>
      <p className="text-sm leading-6 text-text-secondary">Check the shot plan against its source rules and inspect the exact prompt before rendering.</p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Review clip">
        {clips.map((item, index) => (
          <button key={item.startMs} type="button" aria-pressed={clipIndex === index} onClick={() => {
            setClipIndex(index);
            setShotIndex(0);
            setCopyStatus("");
          }} className={cn("ooo-control min-h-11 rounded-xl border border-border-default px-3 text-left", clipIndex === index ? "bg-brand text-ink" : "bg-surface-secondary hover:bg-surface-tertiary")}>
            <span className="block text-xs font-bold">Clip {index + 1}</span>
            <span className="block font-mono text-2xs">{seconds(item.startMs)}–{seconds(item.endMs)}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-border-default py-2 text-xs text-text-secondary">
        <span>{pack.body.settings.model === "seedance-2.0" ? "Seedance 2.0" : "Seedance 2.5"}</span>
        <span>{pack.body.settings.resolution}</span>
        <span>{compiled.duration}s</span>
        <span>{clip.mode === "continuous" ? "Continuous take" : "Edited sequence"}</span>
        <span>{compiled.attachments.length} references</span>
      </div>

      {clip.shots.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Review shot">
          {clip.shots.map((item, index) => (
            <button key={item.startMs} type="button" aria-pressed={shotIndex === index} onClick={() => setShotIndex(index)}
              className={cn("ooo-control min-h-11 rounded-lg border border-border-default px-2.5 text-xs font-semibold", shotIndex === index ? "bg-surface-elevated" : "bg-surface-secondary hover:bg-surface-tertiary")}>
              Shot {index + 1} · {seconds(item.startMs)}–{seconds(item.endMs)}
            </button>
          ))}
        </div>
      )}

      <div className="grid min-w-0 gap-3 min-[1000px]:grid-cols-2">
        <div className={panel}>
          <h3 className="font-bold">Shot {shotIndex + 1} <span className="font-mono text-xs font-normal text-text-secondary">{seconds(shot.startMs)}–{seconds(shot.endMs)}</span></h3>
          <dl className="mt-3 grid gap-2.5">
            {details.map(([label, value]) => <div key={label}><dt className="text-xs font-bold">{label}</dt><dd className="mt-0.5 text-sm leading-5 text-text-secondary">{value}</dd></div>)}
          </dl>
        </div>
        <div className={panel}>
          <h3 className="font-bold">Source rules cited for this shot</h3>
          {!linked.length && <p className="mt-2 text-sm leading-5 text-text-secondary">This shot has no rule citations.</p>}
          {linked.map((index) => {
            const rule = rules[index];
            if (!rule) return null;
            return (
              <details key={index} className="mt-2 rounded-lg border border-border-default px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold capitalize">{topic(rule.topic)} <span className="text-xs font-normal text-text-secondary">· {rule.basis}</span></summary>
                <p className="mt-2 text-sm leading-5 text-text-secondary">{rule.detail}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {rule.evidence.map((ordinal) => {
                    const frame = style.profile.evidence.frames.find((item) => item.ordinal === ordinal);
                    if (!frame) return null;
                    const url = `/api/director/styles/${style.styleId}/frames/${style.id}/${ordinal}`;
                    return (
                      <a key={ordinal} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-border-default">
                        <Image unoptimized loading="lazy" src={url} width={240} height={135} alt={`Source frame ${ordinal + 1}`} className="aspect-video w-full bg-surface-sunken object-contain" />
                        <span className="flex justify-between gap-1 px-1.5 py-1 text-2xs text-text-secondary">{frame.seconds === null ? "Still" : `${frame.seconds.toFixed(2)}s`} <ArrowUpRight size={12} aria-hidden /></span>
                      </a>
                    );
                  })}
                </div>
              </details>
            );
          })}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold">Read pinned guide</summary>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{style.profile.guide}</p>
          </details>
        </div>
      </div>

      {(uncited.length > 0 || clip.promptOverride || hasSource || missingCast.length > 0) && (
        <details className={panel}>
          <summary className="cursor-pointer font-bold">Review flags</summary>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-text-secondary">
            {!!uncited.length && <li>Signature rules with no shot citation in this pack · {[...new Set(uncited.map((rule) => topic(rule.topic)))].join(", ")}.</li>}
            {clip.promptOverride && <li>Clip {clipIndex + 1} has a custom prompt. Check the exact prompt below for the timing and camera directions you want.</li>}
            {hasSource && <li>The original style source is attached to clip {clipIndex + 1} as a render reference.</li>}
            {!!missingCast.length && <li>Clip {clipIndex + 1} has no identity reference for {missingCast.map(({ name }) => name).join(", ")}. Check this if they appear in the clip.</li>}
          </ul>
        </details>
      )}

      <details className={panel}>
        <summary className="cursor-pointer font-bold">Exact render prompt and references</summary>
        <p className="mt-2 break-all font-mono text-2xs text-text-secondary">{compiled.endpoint}</p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{compiled.prompt}</p>
        {compiled.attachments.length > 0 && (
          <ul className="mt-3 divide-y divide-border-default border-y border-border-default text-sm">
            {compiled.attachments.map((file) => <li key={file.assetId} className="py-2"><span className="font-semibold capitalize">{file.modality} {file.index} · {file.role}</span><p className="text-xs text-text-secondary">{file.scope}</p></li>)}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="md" onClick={() => void copy()}><Clipboard size={15} aria-hidden /> Copy prompt</Button>
          <span role="status" className="text-xs text-text-secondary">{copyStatus}</span>
        </div>
      </details>
      {!reviewedAt && <div className="flex flex-wrap items-center gap-2 border-t border-border-default pt-3">
        <Button variant="lime" size="md" disabled={saving} onClick={() => void record()}>Mark pack reviewed</Button>
        {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
      </div>}
    </section>
  );
}
