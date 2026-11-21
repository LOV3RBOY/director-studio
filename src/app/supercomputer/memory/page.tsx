import type { Metadata } from "next";
import { MemoryPanel } from "@/components/super/panels";

export const metadata: Metadata = { title: "Memory · Supercomputer" };

export default function SuperMemoryPage() {
  return <MemoryPanel />;
}
