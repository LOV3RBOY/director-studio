"use client";

import { Check, CircleAlert, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "./cn";

/**
 * Quiet confirmations for actions whose result is not otherwise visible (copied, saved, queued).
 * One polite live region; at most three at once; each leaves after 3.2 s, or on tap.
 */
type Tone = "success" | "error";
interface Item { id: number; tone: Tone; message: string }

let items: Item[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: Tone, message: string) {
  const id = next++;
  items = [...items.slice(-2), { id, tone, message }];
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 5000 : 3200);
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => items);
  return (
    <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+20px)] z-[60] flex flex-col items-center gap-2 px-4">
      {list.map((item) => (
        <div
          key={item.id}
          role={item.tone === "error" ? "alert" : "status"}
          className={cn(
            "ooo-toast pointer-events-auto flex max-w-[420px] min-h-11 items-center gap-2 rounded-full py-2 pr-2 pl-4 text-sm leading-5 font-semibold",
            item.tone === "error" ? "text-danger" : "text-text-primary",
          )}
        >
          {item.tone === "error" ? <CircleAlert className="size-4 shrink-0" aria-hidden /> : <Check className="size-4 shrink-0" aria-hidden />}
          <span className="min-w-0">{item.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(item.id)} className="ooo-control flex size-8 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-border-subtle">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
