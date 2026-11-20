"use client";

import { ArrowUpRight, Check, Menu, Search } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { AccountPanel } from "@/components/shell/account-menu";
import { studioDestinations } from "@/config/studio-workspace";
import { routes } from "@/content/site";
import { superRoutes } from "@/content/super";
import { Dialog, DialogContent, DialogTrigger, cn } from "@/ui";

const sections = [
  { title: "Make", links: studioDestinations.filter(({ id }) => !["agents", "library", "uploads"].includes(id)) },
  { title: "Workspace", links: [
    ...studioDestinations.filter(({ id }) => ["agents", "library", "uploads"].includes(id)),
    { label: "Search Studio", href: routes.search }, { label: "Canvas board", href: `${routes.canvas}/board` },
    { label: "Director chats", href: superRoutes.home }, { label: "Agent projects", href: superRoutes.projects },
    { label: "Agent skills", href: superRoutes.skills }, { label: "Agent memory", href: superRoutes.memory },
    { label: "Connections", href: superRoutes.connectors }, { label: "Schedules", href: superRoutes.schedules },
  ] },
  { title: "Explore", links: [
    { label: "Explore", href: routes.explore }, { label: "Community", href: routes.community },
    { label: "Contests", href: routes.contests }, { label: "Horizon", href: routes.horizon },
    { label: "Guide", href: routes.guide }, { label: "What’s new", href: routes.whatsNew },
  ] },
  { title: "Account and integrations", links: [
    { label: "Settings", href: routes.settings }, { label: "Notifications", href: routes.notifications },
    { label: "Notification settings", href: `${routes.settings}/notifications` },
    { label: "Wallet", href: routes.wallet }, { label: "Plans", href: routes.pricing },
    { label: "Invite", href: routes.invite }, { label: "Developer", href: routes.developer },
    { label: "MCP", href: routes.mcp }, { label: "Enterprise", href: routes.enterprise },
  ] },
];

export function WorkspaceMenu({ visit }: { visit: string }) {
  const sectionsNav = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const visible = sections.map(({ title, links }) => ({ title, links: links.filter(({ label }) => label.toLowerCase().includes(search)) }))
    .filter(({ links }) => links.length);
  const current = sections.flatMap(({ links }) => links).find(({ href }) => href === visit)?.href ?? visit.split("?")[0];

  function toggle(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  return (
    <Dialog open={open} onOpenChange={toggle}>
      <DialogTrigger aria-label="Open Studio navigation" className="ooo-control flex size-11 shrink-0 items-center justify-center rounded-xl border border-border-default bg-surface-secondary hover:bg-surface-elevated">
        <Menu size={19} strokeWidth={1.7} aria-hidden />
      </DialogTrigger>
      <DialogContent title="Studio navigation" aria-describedby={undefined} className="studio-navigation-panel" onOpenAutoFocus={(event) => {
        event.preventDefault();
        sectionsNav.current?.focus();
      }}>
        <div className="shrink-0 border-b border-border-default px-4 pt-4 pb-3 sm:px-6">
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border-default bg-surface-field px-3 focus-within:border-border-strong">
            <Search size={17} aria-hidden className="text-text-secondary" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a section" placeholder="Find a section" className="min-w-0 flex-1 bg-transparent text-base outline-none" />
          </label>
        </div>
        <nav ref={sectionsNav} tabIndex={-1} aria-label="All Studio sections" className="scroll-quiet grid outline-none min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 pt-3 pb-5 sm:px-6">
          {visible.length ? visible.map(({ title, links }) => (
            <section key={title}>
              <h2 className="px-2 pb-1 text-xs font-bold tracking-wide text-text-secondary">{title}</h2>
              <ul className="grid gap-1 min-[350px]:grid-cols-2">
                {links.map(({ label, href }) => (
                  <li key={href}>
                    <Link href={href} prefetch={false} onNavigate={() => toggle(false)} aria-current={href === current ? "page" : undefined}
                      className={cn("ooo-nav-link flex min-h-11 items-center justify-between gap-1 rounded-xl px-2 text-sm leading-5 font-semibold hover:bg-surface-tertiary", href === current && "bg-surface-elevated")}>
                      {label}
                      {href === current ? <Check size={15} aria-hidden className="shrink-0" /> : <ArrowUpRight size={14} aria-hidden className="shrink-0 text-text-secondary" />}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )) : <p role="status" className="px-2 py-2 text-text-secondary">No sections match that search.</p>}
          {!search && <div className="border-t border-border-default pt-2"><AccountPanel onDone={() => toggle(false)} /></div>}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
