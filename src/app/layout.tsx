import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import { WorkspaceBar } from "@/components/workspace/workspace-bar";
import { brand } from "@/config/brand";
import { Toaster } from "@/ui";
import { bootScript } from "@/lib/closable";
import "./globals.css";
import "./out-of-order.css";

const interTight = localFont({ src: "./fonts/InterTight-Variable.ttf", weight: "100 900", variable: "--font-inter-tight", display: "swap" });
const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.ttf", weight: "400" },
    { path: "./fonts/IBMPlexMono-Medium.ttf", weight: "500" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: `${brand.name}: ${brand.tagline}`, template: `%s · ${brand.name}` },
  description: brand.description,
  applicationName: brand.name,
};

export const viewport: Viewport = {
  themeColor: "#EFEFF5",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const fonts = [interTight, plexMono].map((f) => f.variable).join(" ");
  return (
    // The boot script adds `data-closed` to <html> before React starts, hence the suppression.
    <html lang="en" className={fonts} suppressHydrationWarning>
      <head>
        {/* Hides what the visitor closed earlier before the first paint. See src/lib/closable.ts. */}
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <Suspense><WorkspaceBar /></Suspense>
        <div className="studio-pages">{children}</div>
        <Toaster />
      </body>
    </html>
  );
}
