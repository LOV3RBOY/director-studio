"use client";

import { ArrowLeft, ArrowUpRight, Clapperboard } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { SuperComposer, type SendInput } from "@/components/super/composer";
import type { Chat } from "@/components/super/types";
import { workspaceLabel } from "@/config/studio-workspace";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { DialogContent } from "@/ui";

const DockChat = dynamic(() => import("@/components/super/chat").then((module) => module.SuperChat));

export function WorkspaceBar() {
  const { member } = useSession();
  return member ? <MemberWorkspaceBar key={member.id} memberId={member.id} /> : null;
}

function MemberWorkspaceBar({ memberId }: { memberId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const query = useSearchParams().toString();
  const visit = query ? `${pathname}?${query}` : pathname;
  const chatStorageKey = `ooo-director-chat:${memberId}`;
  const label = workspaceLabel(pathname);
  const trail = useRef<string[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const creating = useRef<string | null>(null);

  useEffect(() => {
    if (!label) return;
    const last = trail.current.lastIndexOf(visit);
    trail.current = last >= 0 ? trail.current.slice(0, last + 1) : [...trail.current.slice(-19), visit];
  }, [label, visit]);

  if (!label) return null;

  const back = () => {
    const previous = trail.current.at(-2);
    const fallback = pathname.startsWith("/agents/") || pathname.startsWith("/supercomputer") ? "/agents" : "/studio";
    router.push(previous ?? fallback);
  };

  const send = async (input: SendInput) => {
    const id = creating.current ?? (await api<{ chat: Chat }>("/api/super/chats", {
      method: "POST", body: { agentId: "director", title: "Studio Director" },
    })).chat.id;
    creating.current = id;
    await api(`/api/super/chats/${id}/messages`, { method: "POST", body: input });
    setChatId(id);
    try { localStorage.setItem(chatStorageKey, id); } catch { /* keep this tab's conversation */ }
    setDraft("");
    return true;
  };

  const toggle = (next: boolean) => {
    if (next && !chatId) {
      try {
        const saved = localStorage.getItem(chatStorageKey);
        if (saved && /^[\w-]{1,100}$/.test(saved)) setChatId(saved);
      } catch { /* storage is optional */ }
    }
    setOpen(next);
  };

  const newChat = () => {
    creating.current = null;
    setChatId(null);
    try { localStorage.removeItem(chatStorageKey); } catch { /* storage is optional */ }
  };

  return (
    <div className="studio-workspace-bar">
      <nav aria-label="Studio workspace" className="mx-auto flex h-full max-w-[1600px] items-center gap-2 px-2 sm:px-4">
        {pathname === "/studio" ? null : (
          <button type="button" onClick={back} className="ooo-control flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-2.5 font-semibold hover:bg-surface-elevated">
            <ArrowLeft size={16} aria-hidden /> Back
          </button>
        )}
        <Link href="/studio" className="ooo-control flex h-11 shrink-0 items-center rounded-xl px-2 font-semibold hover:bg-surface-elevated">Studio</Link>
        {pathname !== "/studio" && <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{label}</span>}
        <Dialog.Root open={open} onOpenChange={toggle}>
          <Dialog.Trigger className="ooo-pill ooo-primary ml-auto !min-h-9 !gap-1.5 !px-3">
            <Clapperboard size={15} aria-hidden /> Director
          </Dialog.Trigger>
          <DialogContent title="Studio Director" className="studio-director-panel" aria-describedby={undefined}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border-default px-6 pt-1 pb-3">
              <Link href="/agents" onNavigate={() => setOpen(false)} className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:underline">Agents <ArrowUpRight size={12} aria-hidden /></Link>
              <Link href="/style-library" onNavigate={() => setOpen(false)} className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:underline">Style Library <ArrowUpRight size={12} aria-hidden /></Link>
              {chatId && <button type="button" onClick={newChat} className="text-xs font-semibold text-text-secondary hover:underline">New chat</button>}
              {chatId && <Link href={`/supercomputer/c/${chatId}`} onNavigate={() => setOpen(false)} className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:underline">Open full chat <ArrowUpRight size={12} aria-hidden /></Link>}
            </div>
            {chatId ? (
              <DockChat id={chatId} embedded onNavigate={() => setOpen(false)} />
            ) : (
              <div className="ooo-chat flex min-h-0 flex-1 flex-col justify-between gap-4 p-4">
                <p className="text-sm leading-6 text-text-secondary">Ask for creative direction, help with a tool, or say “open Style Library.”</p>
                <SuperComposer value={draft} onChange={setDraft} onSend={send} placeholder="Ask the Director…" />
              </div>
            )}
          </DialogContent>
        </Dialog.Root>
      </nav>
    </div>
  );
}
