import type { Metadata } from "next";
import { Suspense } from "react";
import { SuperChat } from "@/components/super/chat";

export const metadata: Metadata = { title: "Supercomputer chat" };

export default function SuperChatPage({ params }: PageProps<"/supercomputer/c/[id]">) {
  return (
    <Suspense fallback={<div className="h-dvh bg-surface-primary" />}>
      <ChatById params={params} />
    </Suspense>
  );
}

async function ChatById({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SuperChat id={id} />;
}
