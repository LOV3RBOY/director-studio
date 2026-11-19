import { notFound } from "next/navigation";
import { SuperHome } from "@/components/super/home";
import { findStudioAgent, studioAgents } from "@/config/studio-agents";

export function generateStaticParams() {
  return studioAgents.map(({ id }) => ({ agent: id }));
}

export default async function AgentPage({ params }: PageProps<"/agents/[agent]">) {
  const agent = findStudioAgent((await params).agent);
  if (!agent) notFound();
  return <SuperHome agentId={agent.id} />;
}
