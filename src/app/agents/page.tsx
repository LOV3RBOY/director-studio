import Link from "next/link";
import { Aperture, ArrowLeft, ArrowUpRight, AudioLines, ClipboardList, Clapperboard, Palette, Scissors } from "lucide-react";
import { studioAgents, type StudioAgentId } from "@/config/studio-agents";

const icons = {
  director: Clapperboard,
  intake: ClipboardList,
  camera: Aperture,
  look: Palette,
  editor: Scissors,
  sound: AudioLines,
} satisfies Record<StudioAgentId, typeof Aperture>;

export const metadata = { title: "Agent directory" };

export default function AgentDirectory() {
  return (
    <main className="ooo-ground min-h-dvh">
      <div className="mx-auto max-w-5xl px-5 pt-6 pb-12 sm:px-9 sm:pt-9">
        <nav className="mb-8 flex flex-wrap justify-between gap-3" aria-label="Agent navigation">
          <Link href="/studio" className="ooo-pill"><ArrowLeft size={15} aria-hidden /> Studio</Link>
          <Link href="/supercomputer" className="ooo-pill">Chat history <ArrowUpRight size={15} aria-hidden /></Link>
        </nav>
        <h1 className="ooo-title">Your <span>crew.</span></h1>
        <p className="mt-3 mb-6 text-sm text-text-secondary">Choose a specialist, share your brief, and attach references in chat.</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {studioAgents.map((agent) => {
            const Icon = icons[agent.id];
            return (
              <li key={agent.id}>
                <Link href={`/agents/${agent.id}`} className="ooo-tool h-full">
                  <div className="mb-3 flex items-center justify-between"><Icon size={24} aria-hidden /><ArrowUpRight size={19} aria-hidden className="text-text-secondary" /></div>
                  <p className="font-mono text-2xs font-medium tracking-widest text-text-secondary uppercase">{agent.role}</p>
                  <h2 className="mt-1 text-xl font-bold tracking-tight">{agent.name}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-text-secondary">{agent.description}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
