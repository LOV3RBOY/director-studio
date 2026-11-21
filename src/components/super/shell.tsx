"use client";

import { Dialog as Sheet } from "radix-ui";
import { Menu, PanelLeft } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { LogoMark } from "@/components/brand/logo";
import { copy } from "@/content/super";
import { cn, Tag } from "@/ui";
import { useDemoHint, useSuperEvents } from "./data";
import { Sidebar, type SideId } from "./sidebar";

/**
 * The Supercomputer's own full-screen frame: the sidebar on the left and one rounded pane
 * on the right, exactly one screen tall. No top nav and no promo strip, as drawn. Below
 * 1024 pixels the sidebar becomes a sheet behind a menu button.
 */
export function SuperShell({
  active,
  activeChat,
  corner,
  children,
}: {
  active?: SideId;
  activeChat?: string;
  /** Controls drawn in the pane's top-right corner. */
  corner?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const demoHint = useDemoHint(active);
  // Opening the stream here keeps the chat list live on every page.
  useSuperEvents(() => {});

  return (
    <div className="flex studio-viewport w-full overflow-hidden ooo-ground text-text-primary">
      {/* Wide screens: the sidebar column. */}
      {!collapsed ? (
        <div className="hidden w-[244px] shrink-0 items-center justify-center lg:flex">
          <Sidebar active={active} activeChat={activeChat} onCollapse={() => setCollapsed(true)} />
        </div>
      ) : null}

      <Sheet.Root open={sheet} onOpenChange={setSheet}>
        <main className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
          <div className="ooo-chat relative flex min-h-0 flex-1 flex-col overflow-clip lg:rounded-2xl lg:border lg:border-border-default">
            <div className="ooo-chat-header pointer-events-none absolute top-0 right-0 left-0 z-20 flex h-[62px] items-center justify-between px-3 sm:px-4">
              <div className="pointer-events-auto flex items-center gap-2">
                <Sheet.Trigger
                  aria-label={copy.nav.openMenu}
                  className="ooo-control flex size-11 items-center justify-center rounded-xl border border-border-default bg-surface-secondary text-text-primary hover:bg-surface-tertiary lg:hidden"
                >
                  <Menu className="size-[18px]" strokeWidth={1.65} aria-hidden />
                </Sheet.Trigger>
                {collapsed ? (
                  <button
                    type="button"
                    aria-label={copy.nav.expand}
                    onClick={() => setCollapsed(false)}
                    className="hidden size-8 items-center justify-center rounded-md text-text-primary transition-colors duration-150 hover:bg-border-subtle lg:flex"
                  >
                    <PanelLeft className="size-4" strokeWidth={1.5} aria-hidden />
                  </button>
                ) : null}
                <Link
                  href="/studio"
                  aria-label={copy.nav.home}
                  className={cn("items-center rounded-md", collapsed ? "lg:flex" : "flex")}
                >
                  <LogoMark size={20} />
                </Link>
              </div>
              <div className="pointer-events-auto flex items-center gap-2">
                {demoHint ? (
                  <span title={demoHint}>
                    <Tag tone="neutral">{copy.demo}</Tag>
                  </span>
                ) : null}
                {corner}
              </div>
            </div>
            {children}
          </div>
        </main>
        <Sheet.Portal>
          <Sheet.Overlay className="fixed inset-0 z-40 animate-fade-in bg-scrim lg:hidden" />
          <Sheet.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,88vw)] items-center justify-center border-r border-border-default bg-surface-primary shadow-menu lg:hidden"
          >
            <Sheet.Title className="sr-only">{copy.nav.openMenu}</Sheet.Title>
            <Sidebar active={active} activeChat={activeChat} onCollapse={() => setSheet(false)} onNavigate={() => setSheet(false)} />
          </Sheet.Content>
        </Sheet.Portal>
      </Sheet.Root>
    </div>
  );
}
