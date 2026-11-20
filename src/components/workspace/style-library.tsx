"use client";

import { ArrowUpRight, Aperture, Upload } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import useSWR, { mutate } from "swr";
import { api, errorMessage, fetcher, type Asset } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Brief, StyleProfile } from "@/server/director/contracts";
import type { PackBody } from "@/server/director/compiler";
import { Button, Spinner } from "@/ui";
import { StyleProof } from "./style-proof";

type Job = { kind: string; state: string; error: { message: string } | null };
type StyleVersion = { id: string; version: number; saved: boolean; profile: StyleProfile };
type StyleSummary = { id: string; title: string; latest: StyleVersion | null };
type StyleDetail = { id: string; title: string; versions: StyleVersion[]; analysis: Job[] };
type ProjectSummary = { id: string; title: string };
type ProjectDetail = {
  project: ProjectSummary;
  brief: Brief;
  pinnedStyle: StyleVersion & { title: string; styleId: string };
  reviewedAt: number | null;
  pack: { id: string; version: number; body: PackBody } | null;
  jobs: Job[];
};

const field = "w-full rounded-xl border border-border-default bg-surface-field px-3 py-2 text-base leading-6 font-normal text-text-primary";
const heading = "text-xl leading-tight font-bold tracking-tight";
const pending = (job?: Job) => job?.state === "queued" || job?.state === "running";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">{label}{children}</label>;
}

function Problem({ message }: { message?: string | null }) {
  return message ? <p role="alert" className="text-sm text-danger">{message}</p> : null;
}

function UploadReference({ onCreated }: { onCreated: (id: string) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || files.length > 8 || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setProblem(null);
    try {
      const sources = [...assets];
      for (const file of files.slice(sources.length)) {
        const data = new FormData();
        data.append("file", file);
        sources.push((await api<{ asset: Asset }>("/api/assets", { method: "POST", body: data })).asset);
        setAssets([...sources]);
      }
      const result = await api<{ styleId: string }>("/api/director/styles", {
        method: "POST", body: { assetIds: sources.map(({ id }) => id), title: form.get("title"), notes: form.get("notes") },
      });
      onCreated(result.styleId);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="ooo-panel flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-center gap-3"><span className="ooo-icon-tile"><Upload size={19} aria-hidden /></span><h2 className={heading}>Study a reference</h2></div>
      <Field label="Reference image or video">
        <input type="file" required multiple accept="image/*,video/*" disabled={busy} className={field} onChange={(event) => {
          const selection = Array.from(event.currentTarget.files ?? []);
          setFiles(selection);
          setAssets([]);
          setProblem(selection.length > 8 ? "Choose up to eight references." : null);
        }} />
      </Field>
      <p className="text-sm text-text-secondary">Choose up to eight images or videos for one style.</p>
      <Field label="Style name"><input name="title" required maxLength={120} className={field} /></Field>
      <Field label="What to carry over or ignore"><textarea name="notes" rows={3} maxLength={2400} className={field} /></Field>
      <Problem message={problem} />
      <Button type="submit" variant="lime" size="md" disabled={!files.length || files.length > 8 || busy} className="self-start">{busy ? <><Spinner /> Starting analysis…</> : "Analyze reference"}</Button>
    </form>
  );
}

function ReviewStyle({ id, onSaved }: { id: string; onSaved: () => void }) {
  const resource = useSWR<StyleDetail>(`/api/director/styles/${encodeURIComponent(id)}`, fetcher,
    { refreshInterval: (style) => pending(style?.analysis[0]) ? 1800 : 0 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const style = resource.data;
  const latest = style?.versions[0];
  const saved = style?.versions.find((version) => version.saved);
  const job = style?.analysis[0];

  async function act(action: "save" | "retry", body: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api(`/api/director/styles/${encodeURIComponent(id)}/${action}`, { method: "POST", body });
      await resource.mutate();
      onSaved();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (resource.error) return <Problem message={errorMessage(resource.error)} />;
  if (!style) return <p role="status" className="text-text-secondary">Loading style…</p>;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="ooo-panel flex flex-col gap-4 p-5 sm:p-6">
        <h2 className={heading}>{style.title}</h2>
        {pending(job) && <p role="status" className="flex items-center gap-2 text-text-secondary"><Spinner /> Studying the reference. You can leave and return while it runs.</p>}
        {job?.state === "failed" && (
          <div className="flex flex-wrap items-center gap-3">
            <Problem message={job.error?.message ?? "Analysis couldn’t finish."} />
            <Button disabled={busy} onClick={() => void act("retry")}>Retry analysis</Button>
          </div>
        )}
        <Problem message={problem} />
        {latest && (
          <>
            <p className="text-sm text-text-secondary">{latest.saved ? `Saved guide · v${latest.version}` : "Draft guide"}{latest.profile.fixture ? " · Sample analysis" : ""}</p>
            <form key={latest.id} className="flex flex-col gap-3" onSubmit={(event) => {
              event.preventDefault();
              const guide = new FormData(event.currentTarget).get("guide");
              void act("save", { previousId: latest.id, guide });
            }}>
              <Field label="Style guide"><textarea name="guide" defaultValue={latest.profile.guide} required maxLength={18000} rows={9} className={field} /></Field>
              <Button type="submit" variant="lime" size="md" disabled={busy || pending(job)} className="self-start">{latest.saved ? "Save new version" : "Save style"}</Button>
            </form>
            <details className="rounded-xl border border-border-default p-3">
              <summary className="font-semibold">Evidence and directing rules</summary>
              <ul className="mt-4 grid gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4">
                {latest.profile.evidence.frames.map((frame) => (
                  <li key={frame.ordinal} className="overflow-hidden rounded-lg bg-surface-tertiary">
                    <Image unoptimized src={`/api/director/styles/${style.id}/frames/${latest.id}/${frame.ordinal}`} alt={`Reference frame ${frame.ordinal + 1}`} width={320} height={180} className="aspect-video w-full object-contain" />
                    <p className="px-2 py-1 text-xs text-text-secondary">{frame.source !== undefined ? `Source ${frame.source + 1} · ` : ""}{frame.seconds === null ? "Still" : `${frame.seconds.toFixed(2)} s`}{frame.cutCandidate ? " · Possible cut" : ""}</p>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 grid gap-3">
                {latest.profile.rules.map((rule, index) => (
                  <div key={index} className="border-t border-border-subtle pt-2">
                    <dt className="font-semibold capitalize">{rule.topic.replaceAll("-", " ")} <span className="font-normal text-text-secondary">· {rule.basis} · {rule.reuse}</span></dt>
                    <dd className="text-sm leading-6 text-text-secondary">{rule.detail}{rule.evidence.length ? ` · Frames ${rule.evidence.map((ordinal) => ordinal + 1).join(", ")}` : ""}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        )}
      </section>
      {saved && <NewStyledProject version={saved} />}
    </div>
  );
}

function NewStyledProject({ version }: { version: StyleVersion }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const data = new FormData(event.currentTarget);
    try {
      const project = await api<{ projectId: string }>("/api/director/projects", {
        method: "POST",
        body: {
          styleVersionId: version.id, title: data.get("title"), brief: data.get("brief"),
          duration: Number(data.get("duration")), aspect: data.get("aspect"), model: data.get("model"),
        },
      });
      void mutate("/api/director/projects");
      router.push(`/style-library?project=${project.projectId}`);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="ooo-panel flex flex-col gap-4 p-5 sm:p-6">
      <h2 className={heading}>Use this style</h2>
      <p className="text-sm leading-6 text-text-secondary">This project will use guide v{version.version}. Give it a fresh brief, setting, and characters.</p>
      <Field label="Project name"><input name="title" required maxLength={120} className={field} /></Field>
      <Field label="New creative brief"><textarea name="brief" required maxLength={3500} rows={4} className={field} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Length in seconds"><input name="duration" type="number" min={4} max={60} defaultValue={10} required className={field} /></Field>
        <Field label="Aspect ratio"><select name="aspect" defaultValue="16:9" className={field}>{["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="Render model"><select name="model" defaultValue="seedance-2.0" className={field}><option value="seedance-2.0">Seedance 2.0</option><option value="seedance-2.5">Seedance 2.5</option></select></Field>
      </div>
      <Problem message={problem} />
      <Button type="submit" variant="lime" size="md" disabled={busy} className="self-start">{busy ? <><Spinner /> Starting storyboard…</> : "Create styled project"}</Button>
    </form>
  );
}

function StyledProject({ id }: { id: string }) {
  const key = `/api/director/projects/${encodeURIComponent(id)}`;
  const resource = useSWR<ProjectDetail>(key, fetcher, { refreshInterval: (project) => pending(project?.jobs.find((job) => job.kind === "plan")) ? 1800 : 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const project = resource.data;
  const plan = project?.jobs.find((job) => job.kind === "plan");
  async function retry() {
    setProblem(null);
    setBusy(true);
    try {
      await api(`${key}/plan`, { method: "POST", body: {} });
      await resource.mutate();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (resource.error) return <Problem message={errorMessage(resource.error)} />;
  if (!project) return <p role="status">Loading project…</p>;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="ooo-panel flex min-w-0 flex-col gap-3 p-5 sm:p-6">
        <h2 className={heading}>{project.project.title}</h2>
        {!project.pack && <p className="text-sm text-text-secondary">Pinned style · {project.pinnedStyle.title} v{project.pinnedStyle.version}</p>}
        {pending(plan) && <p role="status" className="flex items-center gap-2"><Spinner /> Building the storyboard…</p>}
        {plan?.state === "failed" && <><Problem message={plan.error?.message} /><Button disabled={busy} onClick={() => void retry()} className="self-start">Retry storyboard</Button></>}
        <Problem message={problem} />
        {project.pack && <Link href={`/cinema?project=${project.project.id}`} className="ooo-pill ooo-primary self-start">Open storyboard in Cinema <ArrowUpRight size={15} aria-hidden /></Link>}
      </section>
      {project.pack && <StyleProof key={project.pack.id} pack={project.pack} style={project.pinnedStyle} cast={project.brief.cast} reviewedAt={project.reviewedAt}
        onReviewed={(reviewedAt) => void resource.mutate((current) => current && current.pack?.id === project.pack?.id ? { ...current, reviewedAt } : current)} />}
    </div>
  );
}

export function StyleLibrary() {
  const router = useRouter();
  const search = useSearchParams();
  const style = search.get("style");
  const project = search.get("project");
  const { member, loading } = useSession();
  const styles = useSWR<{ styles: StyleSummary[] }>(member ? "/api/director/styles" : null, fetcher);
  const projects = useSWR<{ projects: ProjectSummary[] }>(member ? "/api/director/projects" : null, fetcher);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-7 pb-12 sm:px-8 sm:pt-10">
      <header className="ooo-hero mb-6 p-5 sm:p-7">
        <span className="ooo-icon-tile mb-4"><Aperture size={20} aria-hidden /></span>
        <h1 className="text-4xl leading-tight font-bold tracking-[-0.045em] sm:text-5xl">Style Library</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">Study a reference, review how its look and rhythm were made, and save those rules to direct a new project.</p>
      </header>
      {loading ? <p role="status">Loading Studio…</p> : !member ? (
        <div className="ooo-panel p-5"><Link href="/login?next=%2Fstyle-library" className="ooo-pill ooo-primary">Sign in to Style Library</Link></div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-[minmax(210px,1fr)_minmax(0,2.4fr)]">
          <aside className="ooo-panel grid min-w-0 gap-4 p-4">
            <Link href="/style-library" className="ooo-pill">Study a new reference</Link>
            <div>
              <h2 className="mb-2 font-bold">Styles</h2>
              <Problem message={styles.error && errorMessage(styles.error)} />
              {!styles.data ? <p className="text-text-secondary">Loading styles…</p> : !styles.data.styles.length ? <p className="text-text-secondary">No styles yet.</p> : (
                <ul className="scroll-quiet grid max-h-44 gap-1.5 overflow-y-auto">
                  {styles.data.styles.map((entry) => (
                    <li key={entry.id}>
                      <Link href={`/style-library?style=${entry.id}`} aria-current={entry.id === style ? "page" : undefined} className="ooo-nav-link block rounded-lg px-2.5 py-2 hover:bg-surface-tertiary">
                        <span className="block font-semibold">{entry.title}</span><span className="text-xs text-text-secondary">{entry.latest?.saved ? `Saved · v${entry.latest.version}` : entry.latest ? "Draft guide" : "Awaiting analysis"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!!projects.data?.projects.length && (
              <div className="border-t border-border-default pt-3">
                <h2 className="mb-2 font-bold">Styled projects</h2>
                {projects.data.projects.map((entry) => <Link key={entry.id} href={`/style-library?project=${entry.id}`} aria-current={entry.id === project ? "page" : undefined} className="ooo-nav-link block rounded-lg px-2.5 py-2 font-semibold hover:bg-surface-tertiary">{entry.title}</Link>)}
              </div>
            )}
          </aside>
          {style ? <ReviewStyle key={style} id={style} onSaved={() => void styles.mutate()} /> : project ? <StyledProject key={project} id={project} /> : <UploadReference onCreated={(id) => {
            void styles.mutate();
            router.push(`/style-library?style=${id}`);
          }} />}
        </div>
      )}
    </div>
  );
}
