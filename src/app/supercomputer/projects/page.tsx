import type { Metadata } from "next";
import { ProjectsPanel } from "@/components/super/panels";

export const metadata: Metadata = { title: "Projects · Supercomputer" };

export default function SuperProjectsPage() {
  return <ProjectsPanel />;
}
