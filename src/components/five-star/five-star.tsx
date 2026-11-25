"use client";

/**
 * FIVE STAR: a thin wrapper around the models with the game's look locked in.
 *   Photo                  reference photos + scene -> `five-star` (Nano Banana Pro)
 *   Video · References     reference photos + scene -> `five-star-video` (Seedance 2.5 on MuAPI)
 *   Video · Frames         first (+ last) frame + scene -> `five-star-frames` (Seedance 2.5 on MuAPI)
 * "Make it move" on a photo runs Frames with that photo as the first frame.
 * Built on the Apps API, so jobs, credits, refunds and the Library work as everywhere else.
 */
import {
  Building2, CarFront, Clapperboard, Download, IdCard, Image as ImageIcon, Play, Plus, RotateCcw, Siren, Star, TreePalm, Vault, X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { LoginDialog } from "@/components/entry/login-dialog";
import type { AppDetail, AppRun, Price } from "@/components/apps/types";
import { formatCredits } from "@/config/economy";
import { fiveStarCopy as copy, fiveStarLooks, fiveStarStarters } from "@/content/five-star";
import { api, errorMessage, fetcher, type Asset, type Job } from "@/lib/api";
import { useNow } from "@/lib/browser";
import { refreshSession, setBalance, useSession } from "@/lib/session";
import { isActive } from "@/lib/studio";
import { Spinner, cn } from "@/ui";

const PHOTO = "five-star";
const VIDEO = "five-star-video";
const FRAMES = "five-star-frames";
type AppId = typeof PHOTO | typeof VIDEO | typeof FRAMES;
const CAST_KEY = "fivestar.cast.v2";
const MAX_YOU = 3;
const MAX_CREW = 3;

const STARTER_ICON: Record<string, LucideIcon> = {
  mugshot: IdCard, chase: Siren, beach: TreePalm, heist: Vault, "night-drive": CarFront, penthouse: Building2,
};

const field = "w-full rounded-xl border border-border-default bg-surface-field px-3 py-2.5 text-base leading-6 text-text-primary placeholder:text-text-tertiary focus:border-border-strong focus:outline-none";
const label = "text-[11px] leading-4 font-semibold tracking-[0.14em] text-text-secondary uppercase";

type Mode = "photo" | "video";
type Source = "refs" | "frames";
type Cast = { you: Asset[]; crew: Asset[] };
type Slot = "you" | "crew" | "first" | "last";
const slim = (a: Asset) => ({ id: a.id, url: a.url, posterUrl: a.posterUrl, kind: a.kind }) as Asset;

/** The cast lives in localStorage, read with useSyncExternalStore so the server render stays empty. */
const castStore = (() => {
  const empty: Cast = { you: [], crew: [] };
  const ok = (v: unknown): v is Asset[] => Array.isArray(v) && v.every((a) => a && typeof a.id === "string" && typeof a.url === "string");
  let cache: Cast | null = null;
  const listeners = new Set<() => void>();
  return {
    get(): Cast {
      if (cache) return cache;
      try {
        const raw = JSON.parse(window.localStorage.getItem(CAST_KEY) ?? "null");
        cache = raw && ok(raw.you) && ok(raw.crew) ? raw : empty;
      } catch {
        cache = empty;
      }
      return cache!;
    },
    server: () => empty,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    set(next: Cast) {
      cache = next;
      try {
        window.localStorage.setItem(CAST_KEY, JSON.stringify(next));
      } catch {
        /* private mode: kept for this visit only */
      }
      listeners.forEach((fn) => fn());
    },
  };
})();

const done = (j: Job | undefined): j is Job => !!j && j.status === "succeeded" && j.assets.length > 0;

function Wanted({ level }: { level: number }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-0.5" role="img" aria-label={copy.wanted(level)}>
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} size={15} strokeWidth={1.75} aria-hidden className={cn("transition-colors duration-300", i < level ? "fill-current text-text-primary" : "text-text-tertiary opacity-40")} />
        ))}
      </div>
      {level >= 5 ? <p className="font-mono text-[10px] leading-3 tracking-[0.12em] whitespace-nowrap text-text-secondary uppercase">{copy.wanted(level)}</p> : null}
    </div>
  );
}

function Segment<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { value: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid grid-cols-2 gap-1 rounded-full border border-border-default bg-surface-tertiary p-1">
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-option={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "ooo-control flex min-h-10 items-center justify-center gap-1.5 rounded-full text-sm leading-5 font-semibold",
              on ? "bg-surface-primary text-text-primary shadow-[0_1px_3px_#1d18301f,inset_0_1px_0_#fff]" : "text-text-secondary hover:text-text-primary",
            )}
          >
            {Icon ? <Icon size={15} strokeWidth={1.75} aria-hidden /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A picked image: a rounded tile, like a thumbnail in the Library. */
function Tile({ asset, tag, onRemove, wide }: { asset: Asset; tag?: string; onRemove?: () => void; wide?: boolean }) {
  return (
    <span className={cn("relative block h-20 shrink-0 overflow-clip rounded-xl border border-border-default bg-surface-tertiary", wide ? "w-28" : "w-16")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.posterUrl ?? asset.url} alt={tag ?? "You"} className="size-full object-cover" />
      {tag ? <span className="absolute inset-x-1 bottom-1 rounded-md bg-black/55 text-center text-[10px] leading-4 font-semibold text-white backdrop-blur-sm">{tag}</span> : null}
      {onRemove ? (
        <button type="button" aria-label={`Remove ${tag ?? "photo"}`} onClick={onRemove} className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
          <X size={11} strokeWidth={2.25} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

function AddTile({ text, onClick, busy, kind, wide }: { text: string; onClick: () => void; busy: boolean; kind: string; wide?: boolean }) {
  return (
    <button
      type="button"
      data-upload={kind}
      onClick={onClick}
      disabled={busy}
      className={cn("ooo-control flex h-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border-strong bg-surface-secondary text-text-secondary hover:text-text-primary", wide ? "w-28" : "w-16")}
    >
      {busy ? <Spinner label="Uploading" /> : <Plus size={16} strokeWidth={1.75} aria-hidden />}
      <span className="text-[11px] leading-4 font-semibold">{text}</span>
    </button>
  );
}

export function FiveStar() {
  const { user, loading: sessionLoading } = useSession();
  const photoApp = useSWR<{ app: AppDetail }>(`/api/apps/${PHOTO}`, fetcher);
  const framesApp = useSWR<{ app: AppDetail }>(`/api/apps/${FRAMES}`, fetcher);
  const looks = useMemo(() => {
    const f = photoApp.data?.app.form.fields.find((x) => x.id === "look");
    return f && f.type === "choice" ? f.options : [];
  }, [photoApp.data]);
  const now = useNow();
  const day = now === null ? null : Math.floor(now / 86400);
  const today = day === null ? null : fiveStarStarters[day % fiveStarStarters.length].id;

  const cast = useSyncExternalStore(castStore.subscribe, castStore.get, castStore.server);
  const [mode, setMode] = useState<Mode>("photo");
  const [source, setSource] = useState<Source>("refs");
  const [frames, setFrames] = useState<{ first: Asset | null; last: Asset | null }>({ first: null, last: null });
  const [concept, setConcept] = useState("");
  const scene = concept.trim();
  const [look, setLook] = useState("in-engine");
  const [uploading, setUploading] = useState<Slot | null>(null);
  const [busy, setBusy] = useState<"make" | "move" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [price, setPrice] = useState<Price | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<Slot>("you");

  const appId: AppId = mode === "photo" ? PHOTO : source === "refs" ? VIDEO : FRAMES;
  const usesCast = appId !== FRAMES;
  const inputs = useMemo((): Record<string, string[]> => {
    if (usesCast) return { you: cast.you.map((a) => a.id), crew: cast.crew.map((a) => a.id) };
    return { first: frames.first ? [frames.first.id] : [], last: frames.last ? [frames.last.id] : [] };
  }, [usesCast, cast, frames]);
  const ready = usesCast ? cast.you.length > 0 : !!frames.first;

  // The member's runs of all three apps, polled while anything is being made.
  const runsOf = (id: AppId) => (user ? `/api/apps/${id}/runs?limit=24` : null);
  const photoRuns = useSWR<{ runs: AppRun[] }>(runsOf(PHOTO), fetcher);
  const videoRuns = useSWR<{ runs: AppRun[] }>(runsOf(VIDEO), fetcher);
  const framesRuns = useSWR<{ runs: AppRun[] }>(runsOf(FRAMES), fetcher);
  const reloaders = useMemo(() => ({ [PHOTO]: photoRuns.mutate, [VIDEO]: videoRuns.mutate, [FRAMES]: framesRuns.mutate }), [photoRuns.mutate, videoRuns.mutate, framesRuns.mutate]);
  const all = useMemo(
    () => [...(photoRuns.data?.runs ?? []), ...(videoRuns.data?.runs ?? []), ...(framesRuns.data?.runs ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [photoRuns.data, videoRuns.data, framesRuns.data],
  );
  const working = all.some((r) => r.jobs.some(isActive));
  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => Object.values(reloaders).forEach((reload) => void reload()), 1500);
    return () => window.clearInterval(t);
  }, [working, reloaders]);
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working) void refreshSession();
    wasWorking.current = working;
  }, [working]);

  // Live price for what the button will run.
  const priceBody = JSON.stringify({
    fields: { concept: scene || "price", look },
    values: {},
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, Math.max(v.length, k === "you" || k === "first" ? 1 : 0)])),
    count: 1,
  });
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      api<{ price: Price }>(`/api/apps/${appId}/price`, { method: "POST", body: JSON.parse(priceBody) })
        .then((r) => live && setPrice(r.price))
        .catch(() => live && setPrice(null));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [appId, priceBody]);
  const movePrice = framesApp.data?.app.price?.millicredits ?? 0;

  const needSession = () => {
    if (user) return true;
    setLoginOpen(true);
    return false;
  };

  function pick(slot: Slot) {
    if (!needSession()) return;
    target.current = slot;
    if (fileRef.current) {
      fileRef.current.multiple = slot === "you";
      fileRef.current.click();
    }
  }

  async function upload(list: FileList | null) {
    const slot = target.current;
    if (!list?.length) return;
    setProblem(null);
    setUploading(slot);
    const room = slot === "you" ? MAX_YOU : slot === "crew" ? MAX_CREW - cast.crew.length : 1;
    const added: Asset[] = [];
    try {
      for (const file of Array.from(list).slice(0, room)) {
        const form = new FormData();
        form.append("file", file);
        form.append("accept", "image");
        const { asset } = await api<{ asset: Asset }>("/api/assets", { method: "POST", body: form });
        added.push(slim(asset));
      }
      const nowCast = castStore.get();
      if (slot === "you") castStore.set({ ...nowCast, you: added });
      else if (slot === "crew") castStore.set({ ...nowCast, crew: [...nowCast.crew, ...added].slice(0, MAX_CREW) });
      else setFrames((f) => ({ ...f, [slot]: added[0] ?? null }));
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function run(id: AppId, body: { fields: Record<string, string>; inputs: Record<string, string[]> }, kind: "make" | "move") {
    if (!needSession()) return;
    setProblem(null);
    setBusy(kind);
    try {
      const r = await api<{ run: AppRun; balance: number }>(`/api/apps/${id}/run`, { method: "POST", body: { ...body, values: {}, count: 1 } });
      void setBalance(r.balance);
      await reloaders[id]((d) => ({ runs: [r.run, ...(d?.runs ?? [])] }), { revalidate: true });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const make = () => void run(appId, { fields: { concept: scene, look }, inputs }, "make");

  const latest = all[0];
  const latestJob = latest?.jobs[0];
  const latestAsset = done(latestJob) ? latestJob.assets[0] : null;
  const reel = all.filter((r) => r.appId !== PHOTO).flatMap((r) => r.jobs.filter(done).map((j) => j.assets[0])).slice(0, 3);
  const level = Math.min(5, all.filter((r) => r.jobs.some(done)).length);
  const signedOut = !sessionLoading && !user;
  const canRun = ready && !!scene && busy === null;
  const runLabel = signedOut ? copy.run.signIn : !ready ? (usesCast ? copy.run.needYou : copy.run.needFirst) : !scene ? copy.run.needScene : copy.run[mode];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-7 pb-12 sm:px-8 sm:pt-10">
      <header className="ooo-hero mb-4 flex items-start justify-between gap-4 p-5 sm:p-7">
        <div className="min-w-0">
          <span className="ooo-icon-tile mb-4">
            <Star size={19} strokeWidth={1.75} aria-hidden />
          </span>
          <h1 className="text-4xl leading-tight font-bold tracking-[-0.045em] sm:text-5xl">{copy.title}</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-text-secondary">{copy.pitch}</p>
        </div>
        <Wanted level={level} />
      </header>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
        <section aria-label="Make" className="ooo-panel flex min-w-0 flex-col gap-6 p-5 sm:p-6">
          <div className="grid gap-3 min-[380px]:grid-cols-2">
            <Segment name={copy.make} value={mode} onChange={setMode} options={[{ value: "photo", label: copy.photo, icon: ImageIcon }, { value: "video", label: copy.video, icon: Clapperboard }]} />
            <Segment name={copy.look} value={look} onChange={setLook} options={[...looks].reverse().map((o) => ({ value: o.value, label: fiveStarLooks[o.value] ?? o.label }))} />
          </div>

          {mode === "video" ? <Segment name={copy.from} value={source} onChange={setSource} options={[{ value: "refs", label: copy.references }, { value: "frames", label: copy.frames }]} /> : null}

          <div className="flex flex-col gap-3">
            <p className={label}>{usesCast ? copy.cast : copy.frames}</p>
            {usesCast ? (
              <div className="scroll-none -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
                {cast.you.map((a) => (
                  <Tile key={a.id} asset={a} />
                ))}
                <AddTile kind="you" text={cast.you.length ? copy.change : copy.you} busy={uploading === "you"} onClick={() => pick("you")} />
                {cast.crew.map((a) => (
                  <Tile key={a.id} asset={a} tag={copy.friend} onRemove={() => castStore.set({ ...cast, crew: cast.crew.filter((x) => x.id !== a.id) })} />
                ))}
                {cast.you.length && cast.crew.length < MAX_CREW ? <AddTile kind="crew" text={copy.friend} busy={uploading === "crew"} onClick={() => pick("crew")} /> : null}
              </div>
            ) : (
              <div className="flex gap-2">
                {(["first", "last"] as const).map((slot) => {
                  const a = frames[slot];
                  const name = slot === "first" ? copy.firstFrame : copy.lastFrame;
                  return a ? (
                    <Tile key={slot} wide asset={a} tag={name} onRemove={() => setFrames((f) => ({ ...f, [slot]: null }))} />
                  ) : (
                    <AddTile key={slot} wide kind={slot} text={name} busy={uploading === slot} onClick={() => pick(slot)} />
                  );
                })}
              </div>
            )}
            <p className="text-xs leading-5 text-text-secondary">{usesCast ? (cast.you.length ? copy.castSaved : copy.castHint) : copy.framesHint}</p>
            <input ref={fileRef} type="file" accept="image/*" hidden aria-hidden onChange={(e) => void upload(e.target.files)} />
          </div>

          <div className="flex flex-col gap-3">
            <label htmlFor="five-star-scene" className={label}>
              {copy.scene}
            </label>
            <textarea id="five-star-scene" data-concept value={concept} rows={4} maxLength={400} onChange={(e) => setConcept(e.target.value)} placeholder={copy.scenePlaceholder} className={cn(field, "resize-none")} />
            <p className="text-xs leading-4 text-text-secondary">{copy.starters}</p>
            <div className="scroll-none -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
              {fiveStarStarters.map((o) => {
                const on = concept === o.text;
                const Icon = STARTER_ICON[o.id] ?? Star;
                return (
                  <button key={o.id} type="button" aria-pressed={on} data-starter={o.id} onClick={() => setConcept(o.text)} className="ooo-filter ooo-control flex items-center gap-2 text-sm leading-5">
                    <Icon size={15} strokeWidth={1.75} aria-hidden />
                    {o.label}
                    {today === o.id ? <span className={cn("rounded-full px-1.5 text-[10px] leading-4 font-bold uppercase", on ? "bg-white/15" : "bg-surface-tertiary text-text-primary")}>{copy.today}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          {problem ? (
            <p role="alert" className="text-sm leading-5 text-danger">
              {problem}
            </p>
          ) : null}

          <button
            type="button"
            data-run="make"
            onClick={signedOut ? () => setLoginOpen(true) : make}
            disabled={!signedOut && !canRun}
            aria-busy={busy === "make"}
            className="ooo-pill ooo-primary min-h-12 w-full text-[15px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "make" ? <Spinner label="Starting" /> : mode === "video" ? <Clapperboard size={16} strokeWidth={1.75} aria-hidden /> : <ImageIcon size={16} strokeWidth={1.75} aria-hidden />}
            {runLabel}
            {price && !signedOut && ready ? (
              <span className="font-mono text-xs leading-4 text-white/55" data-price>
                · {formatCredits(price.millicredits)} cr
              </span>
            ) : null}
          </button>
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          {/* The one dark element on the page: the screen your result lands on. */}
          <section aria-label={copy.result} className="ooo-hero-art relative mx-auto aspect-[9/16] w-full max-w-[420px] overflow-clip rounded-[28px]" data-result={latestAsset ? latestAsset.kind : "empty"}>
            {latestAsset?.kind === "video" ? (
              <video src={latestAsset.url} poster={latestAsset.posterUrl ?? undefined} controls playsInline autoPlay muted loop className="size-full object-cover" />
            ) : latestAsset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={latestAsset.url} alt="Your scene" className="size-full object-cover" />
            ) : null}

            {latestJob && isActive(latestJob) ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#111116a6] text-center backdrop-blur-[2px]">
                <Spinner className="text-white" label={copy.working} />
                <p className="text-sm leading-5 text-white">{latest.appId === PHOTO ? copy.renderingPhoto : copy.renderingVideo}…</p>
              </div>
            ) : latestJob?.status === "failed" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#111116d9] p-8 text-center">
                <p className="text-sm leading-5 text-white">{latestJob.error?.message ?? copy.failed}</p>
                <p className="text-xs leading-4 text-white/60">{copy.refunded}</p>
                <button type="button" onClick={make} className="ooo-pill min-h-10 text-sm">
                  <RotateCcw size={15} strokeWidth={1.75} aria-hidden /> {copy.retry}
                </button>
              </div>
            ) : !latestAsset ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-10 text-center">
                <Star size={28} strokeWidth={1.25} aria-hidden className="text-white/35" />
                <p className="max-w-[220px] text-sm leading-5 text-white/60">{copy.emptyResult}</p>
              </div>
            ) : null}

            {latestAsset && !(latestJob && isActive(latestJob)) ? (
              <div
                className={cn(
                  "absolute inset-x-0 flex items-center justify-between gap-2 p-4",
                  // A video keeps its own controls at the bottom, so its actions sit on top.
                  latestAsset.kind === "video" ? "top-0 bg-gradient-to-b from-black/50 to-transparent pb-10" : "bottom-0 bg-gradient-to-t from-black/70 to-transparent pt-12",
                )}
              >
                <a href={`${latestAsset.url}?download=1`} download aria-label="Download" className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md">
                  <Download size={17} strokeWidth={1.75} aria-hidden />
                </a>
                {latestAsset.kind === "image" ? (
                  <button
                    type="button"
                    data-run="move"
                    disabled={busy !== null}
                    onClick={() => void run(FRAMES, { fields: { concept: String(latest.fields.concept ?? scene), look: String(latest.fields.look ?? look) }, inputs: { first: [latestAsset.id], last: [] } }, "move")}
                    className="ooo-pill min-h-11 disabled:opacity-50"
                  >
                    {busy === "move" ? <Spinner label="Starting" /> : <Play size={13} className="fill-current" strokeWidth={1.75} aria-hidden />}
                    {copy.makeMove}
                    {movePrice ? <span className="font-mono text-xs text-text-secondary">· {formatCredits(movePrice)} cr</span> : null}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          {reel.length ? <Reel clips={reel} /> : null}
        </div>
      </div>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} mode="join" next="/five-star" />
    </div>
  );
}

/** Three video shots make a trailer. Playing it runs them back to back. */
function Reel({ clips }: { clips: Asset[] }) {
  const [playing, setPlaying] = useState<number | null>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const ordered = useMemo(() => [...clips].reverse(), [clips]);
  const full = ordered.length >= 3;
  useEffect(() => {
    if (playing !== null) void ref.current?.play().catch(() => undefined);
  }, [playing]);
  return (
    <section aria-label={copy.reel} className="ooo-panel flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={label}>
            {copy.reel} · {Math.min(3, ordered.length)}/3
          </p>
          {!full ? <p className="mt-1 text-xs leading-4 text-text-secondary">{copy.reelHint}</p> : null}
        </div>
        {full ? (
          <button type="button" data-run="trailer" onClick={() => setPlaying(0)} className="ooo-pill ooo-primary min-h-10 text-sm">
            <Play size={13} className="fill-current" strokeWidth={1.75} aria-hidden /> {copy.playTrailer}
          </button>
        ) : null}
      </div>
      {playing !== null && ordered[playing] ? (
        <div className="ooo-hero-art relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-clip rounded-2xl">
          <video
            ref={ref}
            key={ordered[playing].id}
            src={ordered[playing].url}
            playsInline
            autoPlay
            className="size-full object-cover"
            onEnded={() => setPlaying((p) => (p !== null && p + 1 < ordered.length ? p + 1 : null))}
          />
          <span className="absolute top-3 left-3 font-mono text-[10px] tracking-[0.14em] text-white/80 uppercase">Shot {playing + 1}/3</span>
        </div>
      ) : null}
      <ul className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }, (_, i) => {
          const a = ordered[i];
          return (
            <li key={i} className={cn("relative aspect-[9/16] overflow-clip rounded-xl", a ? "bg-[#111116]" : "border border-dashed border-border-default bg-surface-secondary")}>
              {a ? (
                <video src={a.url} poster={a.posterUrl ?? undefined} muted playsInline className="size-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] tracking-[0.14em] text-text-tertiary uppercase">Shot {i + 1}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
