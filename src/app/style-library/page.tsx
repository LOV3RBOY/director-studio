import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StyleLibrary } from "@/components/workspace/style-library";

export const metadata: Metadata = { title: "Style Library" };

export default function StyleLibraryPage() {
  return <AppShell><Suspense><StyleLibrary /></Suspense></AppShell>;
}
