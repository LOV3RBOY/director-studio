"use client";

import { Info } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useSession } from "@/lib/session";

export function ProviderState() {
  const { user } = useSession();
  const { data } = useSWR<{ media: "live" | "mock" }>(user ? "/api/studio/status" : null, fetcher);
  if (data?.media !== "mock") return null;
  return (
    <p className="mb-4 flex items-start gap-2 rounded-2xl border border-border-default bg-white/80 px-3 py-2 text-xs text-text-secondary">
      <Info size={15} aria-hidden className="shrink-0" />
      Media tools use sample results until Treg is connected.
    </p>
  );
}
