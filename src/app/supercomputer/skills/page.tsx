import type { Metadata } from "next";
import { SkillsPanel } from "@/components/super/panels";

export const metadata: Metadata = { title: "Skills · Supercomputer" };

export default function SuperSkillsPage() {
  return <SkillsPanel />;
}
