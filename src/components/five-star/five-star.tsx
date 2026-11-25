"use client";

/**
 * FIVE STAR: selfie once, tap a scene, get a still; "Make it move" turns it into a trailer shot;
 * three shots fill the trailer reel, which plays back to back. Runs on the Apps API
 * (apps `five-star` and `five-star-motion`), so jobs, credits and the Library work as everywhere else.
 */
import { Check, Download, ImagePlus, Play, RotateCcw, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { LoginDialog } from "@/components/entry/login-dialog";
import type { AppDetail, AppRun, Price } from "@/components/apps/types";
import { formatCredits } from "@/config/economy";
import { api, errorMessage, fetcher, type Asset, type Job } from "@/lib/api";
import { refreshSession, setBalance, useSession } from "@/lib/session";
import { isActive } from "@/lib/studio";
import { Spinner, cn } from "@/ui";

const STILL = "five-star";
const MOTION = "five-star-motion";
const CHARACTER_KEY = "fivestar.character.v1";
const SUNSET = "linear-gradient(135deg,#ff3d8b 0%,#ff7a3d 55%,#ffc23d 100%)";

/** Card art per scene: CSS only, so nothing third-party ships with the page. */
const SCENE_ART: Record<string, { bg: string; line: string }> = {
  mugshot: { bg: "repeating-linear-gradient(0deg,#1b1d22 0 22px,#262931 22px 23px),linear-gradient(#2a2d35,#15161a)", line: "Booked. Unbothered." },
  chase: { bg: "radial-gradient(80% 60% at 20% 30%,#ff2d55aa,transparent 60%),radial-gradient(80% 60% at 80% 40%,#2d7bffaa,transparent 60%),#0b0c12", line: "Five stars. No brakes." },
  beach: { bg: "linear-gradient(180deg,#ff8a5b 0%,#ff5e9c 45%,#2fd3c9 100%)", line: "Main character energy." },
  heist: { bg: "radial-gradient(70% 50% at 50% 20%,#ff3b3baa,transparent 70%),linear-gradient(#2b2416,#0e0c08)", line: "In and out. Mostly." },
  "night-drive": { bg: "linear-gradient(180deg,#1a0b2e 0%,#5b1a6b 50%,#ff4fa3 100%)", line: "Top down, city on." },
  penthouse: { bg: "linear-gradient(180deg,#ff9a3d 0%,#ff4f6d 50%,#2a1238 100%)", line: "Made it. Obviously." },
};

type Values = Record<string, string | number | boolean>;

/** The saved character, kept on this device so every scene reuses it. */
const characterStore = (() => {
  let cache: Asset[] | null = null;
  const listeners = new Set<() => void>();
  const read = (): Asset[] => {
    try {
      const raw = window.localStorage.getItem(CHARACTER_KEY);
      const list = raw ? (JSON.parse(raw) as Asset[]) : [];
      return Array.isArray(list) ? list.filter((a) => a && typeof a.id === "string" && typeof a.url === "string").slice(0, 3) : [];
    } catch {
      return [];
    }
  };
  return {
    get: () => (cache ??= read()),
    server: (): Asset[] => EMPTY,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(list: Asset[]) {
      cache = list.map(({ id, url, posterUrl, kind }) => ({ id, url, posterUrl, kind }) as Asset);
      try {
        window.localStorage.setItem(CHARACTER_KEY, JSON.stringify(cache));
      } catch {
        /* private mode: the character lives for this visit only */
      }
      listeners.forEach((fn) => fn());
    },
  };
})();
const EMPTY: Asset[] = [];

/** Today's Job: the same scene for everyone on a given day. */
function sceneOfTheDay(ids: string[]): string | null {
  if (ids.length === 0) return null;
  const d = new Date();
  const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return ids[day % ids.length];
}

const done = (j: Job) => j.status === "succeeded" && j.assets.length > 0;

function WantedMeter({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`Wanted level ${level} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn("size-5 transition-all duration-300", i < level ? "scale-100" : "scale-90 opacity-25")}
          strokeWidth={1.5}
          style={i < level ? { fill: "#ffc23d", color: "#ffc23d", filter: "drop-shadow(0 0 6px #ff7a3d99)" } : { color: "#9aa0aa" }}
          aria-hidden
        />
      ))}
    </div>
  );
}

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[11px] leading-4 font-semibold tracking-[0.18em] text-text-tertiary uppercase">
      <span className="font-mono text-text-secondary">0{n}</span>
      {children}
    </p>
  );
}

function Working({ job, label }: { job: Job; label: string }) {
  return (
    <div className="shimmer absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-secondary text-center">
      <Spinner className="text-text-tab" label={label} />
      <p className="text-sm leading-5 text-text-primary">{job.status === "running" ? label : "In line…"}</p>
    </div>
  );
}

export function FiveStar() {
  const { user, loading: sessionLoading } = useSession();
  const still = useSWR<{ app: AppDetail }>(`/api/apps/${STILL}`, fetcher);
  const motion = useSWR<{ app: AppDetail }>(`/api/apps/${MOTION}`, fetcher);
  const app = still.data?.app;

  const scenes = useMemo(() => {
    const f = app?.form.fields.find((x) => x.id === "scene");
    return f && f.type === "choice" ? f.options : [];
  }, [app]);
  const looks = useMemo(() => {
    const f = app?.form.fields.find((x) => x.id === "look");
    return f && f.type === "choice" ? f.options : [];
  }, [app]);
  const daily = useMemo(() => sceneOfTheDay(scenes.map((s) => s.value)), [scenes]);

  const character = useSyncExternalStore(characterStore.subscribe, characterStore.get, characterStore.server);
  const [picked, setScene] = useState<string>("");
  const scene = picked || daily || "";
  const [look, setLook] = useState<string>("in-engine");
  const [twist, setTwist] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<"still" | "motion" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [price, setPrice] = useState<Price | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);


  const stillRuns = useSWR<{ runs: AppRun[] }>(user ? `/api/apps/${STILL}/runs?limit=24` : null, fetcher);
  const motionRuns = useSWR<{ runs: AppRun[] }>(user ? `/api/apps/${MOTION}/runs?limit=24` : null, fetcher);
  const working = [...(stillRuns.data?.runs ?? []), ...(motionRuns.data?.runs ?? [])].some((r) => r.jobs.some(isActive));
  const { mutate: reloadStill } = stillRuns;
  const { mutate: reloadMotion } = motionRuns;
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

  // Live price for the still.
  useEffect(() => {
    if (!app) return;
    let live = true;
    const t = window.setTimeout(() => {
      api<{ price: Price }>(`/api/apps/${STILL}/price`, { method: "POST", body: { fields: { scene, look, concept: twist }, values: {}, inputs: { you: Math.max(1, character.length) }, count: 1 } })
        .then((r) => live && setPrice(r.price))
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [app, scene, look, twist, character.length]);

  const needSession = useCallback(() => {
    if (user) return true;
    setLoginOpen(true);
    return false;
  }, [user]);

  async function upload(list: FileList | null) {
    if (!list?.length || !needSession()) return;
    setProblem(null);
    setUploading(true);
    let next: Asset[] = [];
    try {
      for (const file of Array.from(list).slice(0, 3)) {
        const form = new FormData();
        form.append("file", file);
        form.append("accept", "image");
        const { asset } = await api<{ asset: Asset }>("/api/assets", { method: "POST", body: form });
        next = [...next, asset];
      }
      characterStore.set(next);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function run(appId: string, body: { fields: Values; inputs: Record<string, string[]> }, kind: "still" | "motion") {
    if (!needSession()) return;
    setProblem(null);
    setBusy(kind);
    try {
      const r = await api<{ run: AppRun; balance: number }>(`/api/apps/${appId}/run`, { method: "POST", body: { ...body, values: {}, count: 1 } });
      void setBalance(r.balance);
      const reload = kind === "still" ? reloadStill : reloadMotion;
      await reload((d) => ({ runs: [r.run, ...(d?.runs ?? [])] }), { revalidate: true });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const makeStill = () => void run(STILL, { fields: { scene, look, concept: twist }, inputs: { you: character.map((a) => a.id) } }, "still");
  const makeMove = (r: AppRun, asset: Asset) => void run(MOTION, { fields: { scene: String(r.fields.scene ?? scene) }, inputs: { still: [asset.id] } }, "motion");

  const stills = stillRuns.data?.runs ?? [];
  const clips = motionRuns.data?.runs ?? [];
  const latest = stills[0];
  const latestJob = latest?.jobs[0];
  const latestAsset = latestJob && done(latestJob) ? latestJob.assets[0] : null;
  const moving = latestAsset ? clips.find((r) => r.inputs.still?.[0] === latestAsset.id) : undefined;
  const movingJob = moving?.jobs[0];
  const reel = clips.flatMap((r) => r.jobs.filter(done).map((j) => j.assets[0])).slice(0, 3);
  const created = stills.filter((r) => r.jobs.some(done)).length + reel.length;
  const level = Math.min(5, created);
  const signedOut = !sessionLoading && !user;
  const canRun = !!app && character.length > 0 && !!scene && busy === null;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-10 px-4 pt-8 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[44px] leading-[40px] font-bold tracking-[-0.04em] text-text-primary uppercase sm:text-[64px] sm:leading-[56px]">
            Five <span style={{ backgroundImage: SUNSET, WebkitBackgroundClip: "text", color: "transparent" }}>Star</span>
          </h1>
          <p className="max-w-[420px] text-sm leading-5 text-text-secondary">One selfie. Pick a scene. Become the lead of your own open-world crime saga.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <WantedMeter level={level} />
          <p className="font-mono text-[11px] leading-4 tracking-[0.12em] text-text-tertiary uppercase">{level >= 5 ? "Most wanted" : `Wanted level ${level}`}</p>
        </div>
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[440px_minmax(0,1fr)]">
        {/* ── the form ── */}
        <section aria-label="Make a scene" className="flex flex-col gap-7 rounded-2xl border border-border-subtle bg-surface-primary p-5">
          <div className="flex flex-col gap-3">
            <StepLabel n={1}>Your character</StepLabel>
            <div className="flex items-center gap-3">
              {character.length > 0 ? (
                <div className="flex -space-x-3">
                  {character.map((a) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={a.id} src={a.posterUrl ?? a.url} alt="" className="size-14 rounded-full border-2 border-surface-primary object-cover" />
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => (needSession() ? fileRef.current?.click() : undefined)}
                disabled={uploading}
                data-upload="character"
                className={cn(
                  "flex h-14 items-center gap-2 rounded-xl px-4 text-sm leading-5 font-medium transition-colors duration-150",
                  character.length ? "bg-surface-tertiary text-text-secondary hover:text-text-primary" : "flex-1 justify-center border border-dashed border-border-default text-text-primary hover:bg-surface-tertiary",
                )}
              >
                {uploading ? <Spinner label="Uploading" /> : <ImagePlus className="size-4" strokeWidth={1.5} aria-hidden />}
                {character.length ? "Change" : "Add 1–3 selfies"}
              </button>
              {character.length ? (
                <button type="button" aria-label="Remove character" onClick={() => characterStore.set([])} className="flex size-9 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary">
                  <X className="size-4" strokeWidth={1.5} aria-hidden />
                </button>
              ) : null}
            </div>
            <p className="text-xs leading-4 text-text-tertiary">{character.length ? "Saved. Every scene uses this character." : "Clear face, good light. Only photos of you, or of friends who said yes."}</p>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-hidden onChange={(e) => void upload(e.target.files)} />
          </div>

          <div className="flex flex-col gap-3">
            <StepLabel n={2}>Look</StepLabel>
            <div role="radiogroup" aria-label="Look" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-tertiary p-1">
              {looks.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={look === o.value}
                  onClick={() => setLook(o.value)}
                  className={cn("h-10 rounded-lg text-sm leading-5 font-semibold transition-colors duration-150", look === o.value ? "bg-surface-primary text-text-primary shadow-pill" : "text-text-secondary hover:text-text-primary")}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <StepLabel n={3}>Scene</StepLabel>
            <div role="radiogroup" aria-label="Scene" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
              {scenes.map((o) => {
                const art = SCENE_ART[o.value];
                const on = scene === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-scene={o.value}
                    onClick={() => setScene(o.value)}
                    className={cn("relative flex aspect-[4/5] flex-col justify-end overflow-clip rounded-xl p-3 text-left transition-transform duration-150 active:scale-[0.97]", on ? "ring-2 ring-[#ff7a3d] ring-offset-2 ring-offset-surface-primary" : "opacity-80 hover:opacity-100")}
                    style={{ background: art?.bg ?? "#1c1e21" }}
                  >
                    <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" aria-hidden />
                    {daily === o.value ? (
                      <span className="absolute top-2 left-2 rounded-full px-2 py-[2px] text-[10px] leading-4 font-bold tracking-[0.08em] text-black uppercase" style={{ backgroundImage: SUNSET }}>
                        Today’s job
                      </span>
                    ) : null}
                    {on ? (
                      <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-white text-black">
                        <Check className="size-4" strokeWidth={2} aria-hidden />
                      </span>
                    ) : null}
                    <span className="relative font-display text-base leading-5 font-bold tracking-[-0.01em] text-white uppercase">{o.label}</span>
                    <span className="relative text-[11px] leading-4 text-white/70">{art?.line}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <StepLabel n={4}>Your twist · optional</StepLabel>
            <input
              value={twist}
              maxLength={160}
              onChange={(e) => setTwist(e.target.value)}
              placeholder="wearing my black suit, holding a gold phone"
              className="h-11 rounded-xl border border-border-subtle bg-surface-secondary px-3 text-sm leading-5 text-text-primary placeholder:text-text-tertiary focus:border-border-default focus:outline-none"
            />
          </div>

          {problem ? (
            <p role="alert" className="rounded-xl bg-[#FF6B6B14] p-3 text-sm leading-5 text-danger">
              {problem}
            </p>
          ) : null}

          <button
            type="button"
            onClick={signedOut ? () => setLoginOpen(true) : makeStill}
            disabled={!signedOut && !canRun}
            data-run="still"
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl text-[15px] leading-5 font-bold tracking-[-0.01em] text-black shadow-pill transition-[transform,opacity] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundImage: SUNSET }}
          >
            {busy === "still" ? <Spinner label="Starting" /> : <Star className="size-4 fill-current" strokeWidth={1.5} aria-hidden />}
            {signedOut ? "Sign in to play" : character.length === 0 ? "Add your selfie first" : "Make my scene"}
            {price && !signedOut && character.length > 0 ? <span className="font-mono text-xs leading-4 text-black/60">· {formatCredits(price.millicredits)} cr</span> : null}
          </button>
        </section>

        {/* ── results ── */}
        <div className="flex min-w-0 flex-col gap-10">
          <section aria-label="Your scene" className="flex flex-col gap-4">
            <StepLabel n={5}>Your scene</StepLabel>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative aspect-[9/16] overflow-clip rounded-2xl bg-surface-secondary" data-result="still">
                {latestJob && isActive(latestJob) ? (
                  <Working job={latestJob} label="Rendering your scene" />
                ) : latestAsset ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={latestAsset.url} alt="Your Five Star scene" className="size-full object-cover" />
                    <a href={`${latestAsset.url}?download=1`} download aria-label="Download" className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur-sm">
                      <Download className="size-4" strokeWidth={1.5} aria-hidden />
                    </a>
                  </>
                ) : latestJob?.status === "failed" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                    <p className="text-sm leading-5 text-text-primary">{latestJob.error?.message ?? "That one did not render."}</p>
                    <p className="text-xs leading-4 text-text-secondary">Your credits came back.</p>
                    <button type="button" onClick={makeStill} className="mt-1 flex h-8 items-center gap-1 rounded-md bg-border-subtle px-3 text-sm font-medium text-text-primary">
                      <RotateCcw className="size-4" strokeWidth={1.5} aria-hidden /> Try again
                    </button>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
                    <p className="text-sm leading-5 text-text-tertiary">Your scene lands here. Vertical, ready to post.</p>
                  </div>
                )}
              </div>

              <div className="relative aspect-[9/16] overflow-clip rounded-2xl bg-surface-secondary" data-result="motion">
                {movingJob && isActive(movingJob) ? (
                  <Working job={movingJob} label="Shooting your trailer shot" />
                ) : movingJob && done(movingJob) ? (
                  <video src={movingJob.assets[0].url} poster={movingJob.assets[0].posterUrl ?? undefined} controls playsInline autoPlay muted loop className="size-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
                    <p className="text-sm leading-5 text-text-tertiary">{latestAsset ? "Five seconds. Camera move. Sound." : "Make a scene, then bring it to life."}</p>
                    {latestAsset ? (
                      <button
                        type="button"
                        onClick={() => makeMove(latest!, latestAsset)}
                        disabled={busy !== null}
                        data-run="motion"
                        className="flex h-11 items-center gap-2 rounded-xl bg-text-primary px-5 text-sm leading-5 font-bold text-black transition-transform duration-150 active:scale-[0.97] disabled:opacity-40"
                      >
                        {busy === "motion" ? <Spinner label="Starting" /> : <Play className="size-3 fill-current" strokeWidth={1.5} aria-hidden />}
                        Make it move
                        {motion.data?.app.price ? <span className="font-mono text-xs text-black/50">· {formatCredits(motion.data.app.price.millicredits)} cr</span> : null}
                      </button>
                    ) : null}
                    {movingJob?.status === "failed" ? <p className="text-xs leading-4 text-danger">{movingJob.error?.message ?? "That shot failed; credits returned."}</p> : null}
                  </div>
                )}
              </div>
            </div>
          </section>

          <Reel clips={reel} />

          {stills.length > 1 ? (
            <section aria-label="Your scenes" className="flex flex-col gap-4">
              <StepLabel n={7}>Rap sheet</StepLabel>
              <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {stills.slice(1).flatMap((r) =>
                  r.jobs.filter(done).map((j) => (
                    <li key={j.id} className="relative aspect-[9/16] overflow-clip rounded-lg bg-surface-secondary">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={j.assets[0].posterUrl ?? j.assets[0].url} alt="" loading="lazy" className="size-full object-cover" />
                    </li>
                  )),
                )}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} mode="join" next="/five-star" />
    </div>
  );
}

/** Three shots make a trailer. Playing it runs the clips back to back. */
function Reel({ clips }: { clips: Asset[] }) {
  const [playing, setPlaying] = useState<number | null>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const full = clips.length >= 3;
  const ordered = useMemo(() => [...clips].reverse(), [clips]);
  useEffect(() => {
    if (playing !== null) void ref.current?.play().catch(() => undefined);
  }, [playing]);
  return (
    <section aria-label="Your trailer" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <StepLabel n={6}>Your trailer · {Math.min(3, clips.length)}/3 shots</StepLabel>
        {full ? (
          <button type="button" onClick={() => setPlaying(0)} data-run="trailer" className="flex h-9 items-center gap-2 rounded-lg px-4 text-sm leading-5 font-bold text-black" style={{ backgroundImage: SUNSET }}>
            <Play className="size-3 fill-current" strokeWidth={1.5} aria-hidden /> Play trailer
          </button>
        ) : null}
      </div>
      {playing !== null && ordered[playing] ? (
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-clip rounded-2xl bg-black">
          <video
            ref={ref}
            key={ordered[playing].id}
            src={ordered[playing].url}
            playsInline
            autoPlay
            className="size-full object-cover"
            onEnded={() => setPlaying((p) => (p !== null && p + 1 < ordered.length ? p + 1 : null))}
          />
          <span className="absolute top-3 left-3 font-mono text-[11px] tracking-[0.14em] text-white/80 uppercase">Shot {playing + 1}/3</span>
        </div>
      ) : null}
      <ul className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }, (_, i) => {
          const a = ordered[i];
          return (
            <li key={i} className="relative aspect-[9/16] overflow-clip rounded-xl border border-dashed border-border-subtle bg-surface-secondary">
              {a ? (
                <video src={a.url} poster={a.posterUrl ?? undefined} muted playsInline className="size-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center font-mono text-xs tracking-[0.14em] text-text-tertiary uppercase">Shot {i + 1}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
