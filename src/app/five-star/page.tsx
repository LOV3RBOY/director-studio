import type { Metadata } from "next";
import { FiveStar } from "@/components/five-star/five-star";
import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = { title: "Five Star" };

export default function FiveStarPage() {
  return (
    <AppShell>
      <FiveStar />
    </AppShell>
  );
}
