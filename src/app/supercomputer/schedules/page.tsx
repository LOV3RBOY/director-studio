import type { Metadata } from "next";
import { SchedulesPanel } from "@/components/super/panels";

export const metadata: Metadata = { title: "Schedules · Supercomputer" };

export default function SuperSchedulesPage() {
  return <SchedulesPanel />;
}
