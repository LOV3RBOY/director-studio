"use client";

/**
 * FIVE STAR: add your photo (and friends'), choose Photo or Video, a look and a scene.
 * Photo runs the `five-star` app. Video runs it too, then feeds the finished still into
 * `five-star-motion` as the first frame. Three video shots fill the trailer reel.
 * Built on the Apps API, so jobs, credits, refunds and the Library work as everywhere else.
 * Styled with the Out of Order finishes (ooo-hero, ooo-panel, ooo-pill) like the Style Library.
 */
import {
  Building2, CarFront, Clapperboard, Download, IdCard, Image as ImageIcon, Play, Plus, RotateCcw, Siren, Star, TreePalm, Vault, X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

const STILL = "five-star";
const MOTION = "five-star-motion";
const CAST_KEY = "fivestar.cast.v2";
const PENDING_KEY = "fivestar.pending-video.v1";
const MAX_YOU = 3;
const MAX_CREW = 3;

const STARTER_ICON: Record<string, LucideIcon> = {
  mugshot: IdCard, chase: Siren, beach: TreePalm, heist: Vault, "night-drive": CarFront, penthouse: Building2,
};

const field = "w-full rounded-xl border border-border-default bg-surface-field px-3 py-2.5 text-base leading-6 text-text-primary placeholder:text-text-tertiary focus:border-border-strong focus:outline-none";
const label = "text-[11px] leading-4 font-semibold tracking-[0.14em] text-text-secondary uppercase";

type Mode = "photo" | "video";
type Cast = { you: Asset[]; crew: Asset[] };
const slim = (a: Asset) => ({ id: a.id, url: a.url, posterUrl: a.posterUrl, kind: a.kind }) as Asset;

/** A tiny store over localStorage, read with useSyncExternalStore so the server render stays empty. */
function localStore<T>(key: string, empty: T, valid: (v: unknown) => v is T) {
  let cache: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get(): T {
      if (cache) return cache;
      try {
        const raw = JSON.parse(window.localStorage.getItem(key) ?? "null");
        cache = valid(raw) ? raw : empty;
      } catch {
        cache = empty;
      }
      return cache;
    },
    server: () => empty,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    set(next: T) {
      cache = next;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode: kept for this visit only */
      }
      listeners.forEach((fn) => fn());
    },
  };
}

const isAssets = (v: unknown): v is Asset[] => Array.isArray(v) && v.every((a) => a && typeof a.id === "string" && typeof a.url === "string");
const EMPTY_CAST: Cast = { you: [], crew: [] };
const castStore = localStore<Cast>(CAST_KEY, EMPTY_CAST, (v): v is Cast => !!v && typeof v === "object" && isAssets((v as Cast).you) && isAssets((v as Cast).crew));
/** Still runs that should become video once they finish: run id -> the scene text. */
const EMPTY_PENDING: Record<string, string> = {};
const pendingStore = localStore<Record<string, string>>(PENDING_KEY, EMPTY_PENDING, (v): v is Record<string, string> => !!v && typeof v === "object" && !Array.isArray(v));

/** Today's starter: the same for everyone on a given day. */
function sceneOfTheDay(ids: string[], nowSeconds: number | null): string | null {
  if (ids.length === 0 || nowSeconds === null) return null;
  return ids[Math.floor(nowSeconds / 86400) % ids.length];
}

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

/** A photo in the cast: a rounded tile, like a thumbnail in the Library. */
function Tile({ asset, tag, onRemove }: { asset: Asset; tag?: string; onRemove?: () => void }) {
  return (
    <span className="relative block h-20 w-16 shrink-0 overflow-clip rounded-xl border border-border-default bg-surface-tertiary">
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

function AddTile({ text, onClick, busy, kind }: { text: string; onClick: () => void; busy: boolean; kind: string }) {
  return (
    <button type="button" data-upload={kind} onClick={onClick} disabled={busy} className="ooo-control flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border-strong bg-surface-secondary text-text-secondary hover:text-text-primary">
      {busy ? <Spinner label="Uploading" /> : <Plus size={16} strokeWidth={1.75} aria-hidden />}
      <span className="text-[11px] leading-4 font-semibold">{text}</span>
    </button>
  );
}

export function FiveStar() {
  const { user, loading: sessionLoading } = useSession();
  const still = useSWR<{ app: AppDetail }>(`/api/apps/${STILL}`, fetcher);
  const motion = useSWR<{ app: AppDetail }>(`/api/apps/${MOTION}`, fetcher);
  const app = still.data?.app;

  const choices = useCallback(
    (id: string) => {
      const f = app?.form.fields.find((x) => x.id === id);
      return f && f.type === "choice" ? f.options : [];
    },
    [app],
  );
  const looks = useMemo(() => choices("look"), [choices]);
  const now = useNow();
  const day = now === null ? null : Math.floor(now / 86400) * 86400;
  const today = useMemo(() => sceneOfTheDay(fiveStarStarters.map((s) => s.id), day), [day]);

  const cast = useSyncExternalStore(castStore.subscribe, castStore.get, castStore.server);
  const pending = useSyncExternalStore(pendingStore.subscribe, pendingStore.get, pendingStore.server);
  const [mode, setMode] = useState<Mode>("photo");
  const [concept, setConcept] = useState("");
  const scene = concept.trim();
  const [look, setLook] = useState("in-engine");
  const [uploading, setUploading] = useState<"you" | "crew" | null>(null);
  const [busy, setBusy] = useState<Mode | "move" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [price, setPrice] = useState<Price | null>(null);
  const youRef = useRef<HTMLInputElement>(null);
  const crewRef = useRef<HTMLInputElement>(null);

  const stillRuns = useSWR<{ runs: AppRun[] }>(user ? `/api/apps/${STILL}/runs?limit=24` : null, fetcher);
  const motionRuns = useSWR<{ runs: AppRun[] }>(user ? `/api/apps/${MOTION}/runs?limit=24` : null, fetcher);
  const stills = useMemo(() => stillRuns.data?.runs ?? [], [stillRuns.data]);
  const clips = useMemo(() => motionRuns.data?.runs ?? [], [motionRuns.data]);
  const { mutate: reloadStill } = stillRuns;
  const { mutate: reloadMotion } = motionRuns;
  const waitingForVideo = stills.some((r) => pending[r.id]);
  const working = waitingForVideo || [...stills, ...clips].some((r) => r.jobs.some(isActive));
  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => {
      void reloadStill();
      void reloadMotion();
    }, 1500);
    return () => window.clearInterval(t);
  }, [working, reloadStill, reloadMotion]);
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working) void refreshSession();
    wasWorking.current = working;
  }, [working]);

  // Live price of one still. A video adds the motion app's price.
  useEffect(() => {
    if (!app) return;
    let live = true;
    const t = window.setTimeout(() => {
      api<{ price: Price }>(`/api/apps/${STILL}/price`, {
        method: "POST",
        body: { fields: { concept: scene || "price", look }, values: {}, inputs: { you: Math.max(1, cast.you.length), crew: cast.crew.length }, count: 1 },
      })
        .then((r) => live && setPrice(r.price))
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [app, look, cast.you.length, cast.crew.length, scene]);
  const motionPrice = motion.data?.app.price?.millicredits ?? 0;
  const total = price ? price.millicredits + (mode === "video" ? motionPrice : 0) : null;

  const needSession = useCallback(() => {
    if (user) return true;
    setLoginOpen(true);
    return false;
  }, [user]);

  async function upload(list: FileList | null, who: "you" | "crew") {
    if (!list?.length || !needSession()) return;
    setProblem(null);
    setUploading(who);
    const room = who === "you" ? MAX_YOU : MAX_CREW - cast.crew.length;
    const added: Asset[] = [];
    try {
      for (const file of Array.from(list).slice(0, room)) {
        const form = new FormData();
        form.append("file", file);
        form.append("accept", "image");
        const { asset } = await api<{ asset: Asset }>("/api/assets", { method: "POST", body: form });
        added.push(slim(asset));
      }
      const now = castStore.get();
      castStore.set(who === "you" ? { ...now, you: added } : { ...now, crew: [...now.crew, ...added].slice(0, MAX_CREW) });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setUploading(null);
      for (const r of [youRef, crewRef]) if (r.current) r.current.value = "";
    }
  }

  const run = useCallback(
    async (appId: string, body: { fields: Record<string, string>; inputs: Record<string, string[]> }): Promise<AppRun> => {
      const r = await api<{ run: AppRun; balance: number }>(`/api/apps/${appId}/run`, { method: "POST", body: { ...body, values: {}, count: 1 } });
      void setBalance(r.balance);
      const reload = appId === STILL ? reloadStill : reloadMotion;
      await reload((d) => ({ runs: [r.run, ...(d?.runs ?? [])] }), { revalidate: true });
      return r.run;
    },
    [reloadStill, reloadMotion],
  );

  async function make() {
    if (!needSession()) return;
    setProblem(null);
    setBusy(mode);
    try {
      const r = await run(STILL, { fields: { concept: scene, look }, inputs: { you: cast.you.map((a) => a.id), crew: cast.crew.map((a) => a.id) } });
      if (mode === "video") pendingStore.set({ ...pendingStore.get(), [r.id]: scene });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const moveFrom = useCallback(
    async (asset: Asset, sceneId: string) => {
      setProblem(null);
      setBusy("move");
      try {
        await run(MOTION, { fields: { concept: sceneId }, inputs: { still: [asset.id] } });
      } catch (e) {
        setProblem(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [run],
  );

  // A Video request: once its still is finished, shoot the motion from it (once).
  const fired = useRef(new Set<string>());
  useEffect(() => {
    for (const r of stills) {
      const sceneId = pending[r.id];
      if (!sceneId || fired.current.has(r.id)) continue;
      const job = r.jobs[0];
      if (job && isActive(job)) continue;
      fired.current.add(r.id);
      const next = { ...pendingStore.get() };
      delete next[r.id];
      pendingStore.set(next);
      // Deferred: starting the clip updates state, which must not happen inside the effect body.
      if (done(job)) void Promise.resolve().then(() => moveFrom(job.assets[0], sceneId));
    }
  }, [stills, pending, moveFrom]);

  const latest = stills[0];
  const latestJob = latest?.jobs[0];
  const latestStill = done(latestJob) ? latestJob.assets[0] : null;
  const clipRun = latestStill ? clips.find((r) => r.inputs.still?.[0] === latestStill.id) : undefined;
  const clipJob = clipRun?.jobs[0];
  const clipDone = done(clipJob);
  const clipFailed = clipJob?.status === "failed";
  const videoWanted = !!latest && (!!pending[latest.id] || !!clipRun);
  const reel = clips.flatMap((r) => r.jobs.filter(done).map((j) => j.assets[0])).slice(0, 3);
  const level = Math.min(5, stills.filter((r) => r.jobs.some(done)).length + reel.length);
  const signedOut = !sessionLoading && !user;
  const canRun = !!app && cast.you.length > 0 && !!scene && busy === null;
  const runLabel = signedOut ? copy.run.signIn : cast.you.length === 0 ? copy.run.needYou : !scene ? copy.run.needScene : copy.run[mode];

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
        <section aria-label="Make a scene" className="ooo-panel flex min-w-0 flex-col gap-6 p-5 sm:p-6">
          <div className="flex flex-col gap-3">
            <p className={label}>{copy.cast}</p>
            <div className="scroll-none -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
              {cast.you.map((a) => (
                <Tile key={a.id} asset={a} />
              ))}
              <AddTile kind="you" text={cast.you.length ? "Change" : copy.you} busy={uploading === "you"} onClick={() => (needSession() ? youRef.current?.click() : undefined)} />
              {cast.crew.map((a) => (
                <Tile key={a.id} asset={a} tag={copy.friend} onRemove={() => castStore.set({ ...cast, crew: cast.crew.filter((x) => x.id !== a.id) })} />
              ))}
              {cast.you.length && cast.crew.length < MAX_CREW ? (
                <AddTile kind="crew" text={copy.friend} busy={uploading === "crew"} onClick={() => (needSession() ? crewRef.current?.click() : undefined)} />
              ) : null}
            </div>
            <p className="text-xs leading-5 text-text-secondary">{cast.you.length ? copy.castSaved : copy.castHint}</p>
            <input ref={youRef} type="file" accept="image/*" multiple hidden aria-hidden onChange={(e) => void upload(e.target.files, "you")} />
            <input ref={crewRef} type="file" accept="image/*" hidden aria-hidden onChange={(e) => void upload(e.target.files, "crew")} />
          </div>

          <div className="flex flex-col gap-3">
            <label htmlFor="five-star-scene" className={label}>
              {copy.scene}
            </label>
            <textarea
              id="five-star-scene"
              data-concept
              value={concept}
              rows={4}
              maxLength={400}
              onChange={(e) => setConcept(e.target.value)}
              placeholder={copy.scenePlaceholder}
              className={cn(field, "resize-none")}
            />
            <p className="text-xs leading-4 text-text-secondary">{copy.starters}</p>
            <div className="scroll-none -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
              {fiveStarStarters.map((o) => {
                const on = concept === o.text;
                const Icon = STARTER_ICON[o.id] ?? Star;
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    data-starter={o.id}
                    onClick={() => setConcept(o.text)}
                    className="ooo-filter ooo-control flex items-center gap-2 text-sm leading-5"
                  >
                    <Icon size={15} strokeWidth={1.75} aria-hidden />
                    {o.label}
                    {today === o.id ? <span className={cn("rounded-full px-1.5 text-[10px] leading-4 font-bold uppercase", on ? "bg-white/15" : "bg-surface-tertiary text-text-primary")}>{copy.today}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 min-[380px]:grid-cols-2">
            <Segment name={copy.make} value={mode} onChange={setMode} options={[{ value: "photo", label: copy.photo, icon: ImageIcon }, { value: "video", label: copy.video, icon: Clapperboard }]} />
            <Segment name={copy.look} value={look} onChange={setLook} options={[...looks].reverse().map((o) => ({ value: o.value, label: fiveStarLooks[o.value] ?? o.label }))} />
          </div>

          {problem ? (
            <p role="alert" className="text-sm leading-5 text-danger">
              {problem}
            </p>
          ) : null}

          <button
            type="button"
            data-run="make"
            onClick={signedOut ? () => setLoginOpen(true) : () => void make()}
            disabled={!signedOut && !canRun}
            aria-busy={busy === mode}
            className="ooo-pill ooo-primary min-h-12 w-full text-[15px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === mode ? <Spinner label="Starting" /> : mode === "video" ? <Clapperboard size={16} strokeWidth={1.75} aria-hidden /> : <ImageIcon size={16} strokeWidth={1.75} aria-hidden />}
            {runLabel}
            {total !== null && !signedOut && cast.you.length > 0 ? (
              <span className="font-mono text-xs leading-4 text-white/55" data-price>
                · {formatCredits(total)} cr
              </span>
            ) : null}
          </button>
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          {/* The one dark element on the page: the screen your scene lands on. */}
          <section aria-label={copy.result} className="ooo-hero-art relative mx-auto aspect-[9/16] w-full max-w-[420px] overflow-clip rounded-[28px]" data-result={clipDone ? "video" : latestStill ? "photo" : "empty"}>
            {clipDone ? (
              <video src={clipJob.assets[0].url} poster={clipJob.assets[0].posterUrl ?? undefined} controls playsInline autoPlay muted loop className="size-full object-cover" />
            ) : latestStill ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={latestStill.url} alt="Your scene" className={cn("size-full object-cover transition-opacity duration-500", videoWanted && !clipFailed && "opacity-55")} />
            ) : null}

            {latestJob && isActive(latestJob) ? (
              <Overlay text={videoWanted ? copy.renderingVideo : copy.renderingPhoto} />
            ) : videoWanted && !clipDone && !clipFailed ? (
              <Overlay text={copy.renderingVideo} />
            ) : latestJob?.status === "failed" || clipFailed ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#111116d9] p-8 text-center">
                <p className="text-sm leading-5 text-white">{(clipFailed ? clipJob?.error?.message : latestJob?.error?.message) ?? copy.failed}</p>
                <button type="button" onClick={() => void make()} className="ooo-pill min-h-10 text-sm">
                  <RotateCcw size={15} strokeWidth={1.75} aria-hidden /> {copy.retry}
                </button>
              </div>
            ) : !latestStill ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-10 text-center">
                <Star size={28} strokeWidth={1.25} aria-hidden className="text-white/35" />
                <p className="max-w-[220px] text-sm leading-5 text-white/60">{copy.emptyResult}</p>
              </div>
            ) : null}

            {latestStill && !(latestJob && isActive(latestJob)) && (!videoWanted || clipDone) ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-4 pt-12">
                <a
                  href={`${(clipDone ? clipJob.assets[0] : latestStill).url}?download=1`}
                  download
                  aria-label="Download"
                  className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md"
                >
                  <Download size={17} strokeWidth={1.75} aria-hidden />
                </a>
                {!videoWanted ? (
                  <button type="button" data-run="move" disabled={busy !== null} onClick={() => void moveFrom(latestStill, String(latest?.fields.concept ?? scene))} className="ooo-pill min-h-11 disabled:opacity-50">
                    {busy === "move" ? <Spinner label="Starting" /> : <Play size={13} className="fill-current" strokeWidth={1.75} aria-hidden />}
                    {copy.makeMove}
                    {motionPrice ? <span className="font-mono text-xs text-text-secondary">· {formatCredits(motionPrice)} cr</span> : null}
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

function Overlay({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#111116a6] text-center backdrop-blur-[2px]">
      <Spinner className="text-white" label={text} />
      <p className="text-sm leading-5 text-white">{text}…</p>
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
