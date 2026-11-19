import Image from "next/image";
import Link from "next/link";
import { Bell } from "@/components/shell/bell";
import { ProviderState } from "@/components/studio/provider-state";
import { ArrowDown, ArrowUpRight, AudioLines, Clapperboard, Film, ImageIcon, LayoutGrid, PanelsTopLeft, Scissors, Upload, Users, WandSparkles } from "lucide-react";

const tools = [
  { name: "Image", href: "/image", icon: ImageIcon, detail: "Generate and edit stills" },
  { name: "Video", href: "/video", icon: Film, detail: "Generate and refine shots" },
  { name: "Audio", href: "/audio", icon: AudioLines, detail: "Voice, music and sound" },
  { name: "Cinema", href: "/cinema", icon: Clapperboard, detail: "Direct the frame and motion" },
  { name: "Canvas", href: "/canvas", icon: PanelsTopLeft, detail: "Arrange references and outputs" },
  { name: "Apps", href: "/apps", icon: LayoutGrid, detail: "Browse the tool catalog" },
  { name: "Remix", href: "/remix", icon: WandSparkles, detail: "Rework an existing clip" },
  { name: "Shorts", href: "/shorts", icon: Scissors, detail: "Build vertical edits" },
  { name: "Ads", href: "/ads", icon: PanelsTopLeft, detail: "Create campaign assets" },
];

export const metadata = { title: "Studio" };

export default function StudioPage() {
  return (
    <main className="ooo-ground min-h-dvh">
      <div className="mx-auto max-w-5xl px-5 pb-13 sm:px-9">
        <header className="flex items-center justify-between gap-3 border-b border-border-default pt-4 pb-3 sm:pt-6">
          <Image src="/out-of-order/wordmark.png" alt="Out of Order" width={143} height={17} priority className="h-auto w-[143px]" />
          <div className="flex items-center gap-2">
            <Bell size={20} className="ooo-pill ooo-control !w-11 !px-0" />
            <Link href="/library" className="ooo-pill">Library <ArrowUpRight size={15} aria-hidden /></Link>
          </div>
        </header>

        <section aria-labelledby="studio-title" className="ooo-hero mt-5 grid gap-4 p-2.5 sm:mt-7 sm:grid-cols-[1fr_48%]">
          <div className="flex flex-col items-start px-4 py-5 sm:px-7 sm:py-9">
            <h1 id="studio-title" className="ooo-title">Make it <span>yours.</span></h1>
            <p className="mt-4 max-w-[29ch] text-sm leading-6 text-text-secondary sm:text-base">Bring your references, direct the work, and make the cut.</p>
            <div className="mt-5 flex flex-wrap gap-2 sm:mt-7">
              <a href="#tools" className="ooo-pill ooo-primary">Open tools <ArrowDown size={16} aria-hidden /></a>
              <Link href="/agents" className="ooo-pill"><Users size={16} aria-hidden /> Agents</Link>
            </div>
          </div>
          <div className="ooo-hero-art relative aspect-[2.55] overflow-hidden rounded-[20px] sm:aspect-auto">
            <Image src="/out-of-order/hero.png" alt="" fill priority sizes="(min-width: 640px) 460px, 90vw" className="object-cover object-center" />
          </div>
        </section>

        <section aria-labelledby="tools" className="mt-8 sm:mt-12">
          <h2 id="tools" className="mb-3 text-2xl leading-tight font-bold tracking-[-0.04em] sm:text-3xl">Production tools</h2>
          <ProviderState />
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {tools.map(({ name, href, icon: Icon, detail }) => (
              <li key={href}>
                <Link href={href} className="ooo-tool h-full">
                  <div className="mb-3 flex items-start justify-between">
                    <span className="ooo-icon-tile"><Icon size={20} strokeWidth={1.65} aria-hidden /></span>
                    <ArrowUpRight size={16} aria-hidden className="ooo-tool-arrow m-1 text-text-secondary" />
                  </div>
                  <h3 className="text-base leading-tight font-semibold tracking-tight">{name}</h3>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">{detail}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Studio assets" className="ooo-panel relative mt-5 overflow-hidden p-5 sm:p-7">
          <div className="relative z-10">
            <h2 className="text-xl font-bold tracking-tight">Bring your references</h2>
            <p className="mt-1 text-sm text-text-secondary">Images, video and audio for your next production.</p>
            <Link href="/library?upload=1" className="ooo-pill mt-3"><Upload size={15} aria-hidden /> Open uploads</Link>
          </div>
          <Image src="/out-of-order/folder_ref.png" width={148} height={100} alt="" className="absolute right-1 bottom-1 hidden h-auto opacity-80 sm:block" />
        </section>
        <nav aria-label="More from the suite" className="mt-5 flex flex-wrap gap-2">
          {[
            ["Explore", "/explore"], ["Community", "/community"], ["Horizon", "/horizon"],
            ["Contests", "/contests"], ["Developer", "/developer"], ["MCP", "/mcp"], ["Settings", "/settings"], ["Wallet", "/wallet"],
          ].map(([name, href]) => <Link key={href} href={href} className="ooo-pill">{name}</Link>)}
        </nav>
      </div>
    </main>
  );
}
