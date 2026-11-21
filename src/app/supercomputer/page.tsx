import type { Metadata } from "next";
import { SuperHome } from "@/components/super/home";

export const metadata: Metadata = { title: "Supercomputer" };

export default function SupercomputerPage() {
  return <SuperHome />;
}
