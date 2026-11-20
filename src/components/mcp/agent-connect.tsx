"use client";

import { Bot, Check, Copy } from "lucide-react";
import { useState } from "react";
import { mutate } from "swr";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/ui";

/**
 * One tap to connect Grok Bot (or any MCP agent) with full account access: creates the key
 * and shows the exact message to paste into the agent's chat. The key is shown only here, once.
 */
export function AgentConnect() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setProblem(null);
    try {
      const made = await api<{ secret: string }>("/api/developer/keys", {
        method: "POST", body: { name: "Agent · full access", scopes: ["read", "generate", "account"] },
      });
      void mutate("/api/developer/keys");
      setMessage([
        `Add this MCP server: ${window.location.origin}/api/mcp`,
        `Send this header with every request: Authorization: Bearer ${made.secret}`,
        "It is my Out of Order Studio. Call app_routes to see everything you can do, then use app_request to act as me.",
      ].join("\n"));
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!message) return;
    await navigator.clipboard.writeText(message);
    setCopied(true);
  }

  return (
    <section aria-labelledby="agent-connect" className="flex flex-col gap-3 rounded-2xl border border-border-default bg-surface-secondary p-4">
      <div className="flex items-center gap-2">
        <Bot aria-hidden className="size-4" />
        <h2 id="agent-connect" className="text-sm font-semibold text-text-primary">Connect your agent</h2>
      </div>
      <p className="text-sm leading-5 text-text-secondary">
        Gives Grok Bot, or any agent that supports MCP, full use of the app as you: styles, Director projects, renders, the Library and every studio.
        Sign-in, keys, account settings and billing stay off limits. Revoke the key below to disconnect it.
      </p>
      {message ? (
        <>
          <p className="text-xs leading-4 text-text-secondary">Paste this into your agent&apos;s chat. The key is shown only now.</p>
          <pre aria-label="Agent setup message" className="overflow-x-auto rounded-xl bg-surface-tertiary p-3 text-xs leading-5 whitespace-pre-wrap break-all text-text-primary">{message}</pre>
          <Button type="button" variant="lime" size="md" onClick={copy} className="self-start">
            {copied ? <><Check aria-hidden className="size-4" /> Copied</> : <><Copy aria-hidden className="size-4" /> Copy message</>}
          </Button>
        </>
      ) : (
        <Button type="button" variant="lime" size="md" onClick={create} disabled={busy} className="self-start">
          {busy ? "Creating…" : "Create agent connection"}
        </Button>
      )}
      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
    </section>
  );
}
