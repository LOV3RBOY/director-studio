import type { Metadata } from "next";
import { ConnectorsPanel } from "@/components/super/panels";

export const metadata: Metadata = { title: "Connectors · Supercomputer" };

export default function SuperConnectorsPage() {
  return <ConnectorsPanel />;
}
