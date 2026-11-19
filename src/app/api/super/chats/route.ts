import { findStudioAgent } from "@/config/studio-agents";
import { badRequest, intParam, readJson, route } from "@/server/http";
import { listChats, newChat } from "@/server/super/chats";
import { ensureSuper } from "@/server/super/loop";
import { bool, idList, text } from "@/server/super/util";

/** GET /api/super/chats?projectId=&pinned=1&search=&limit=&before=  Newest first, pinned on top. */
export const GET = route(({ req, user }) => {
  ensureSuper();
  const q = req.nextUrl.searchParams;
  const search = q.get("search") ?? "";
  if (search.length > 100) throw badRequest("Search is too long.");
  return {
    chats: listChats(user.id, {
      projectId: q.get("projectId") || undefined,
      pinned: q.get("pinned") === "1",
      search: search.trim() || undefined,
      limit: intParam(req, "limit", 50, 1, 200),
      before: intParam(req, "before", 0, 0, Number.MAX_SAFE_INTEGER) || undefined,
    }),
  };
});

/** POST /api/super/chats  { title?, projectId?, skillIds?, incognito?, agentId? } */
export const POST = route(async ({ req, user }) => {
  ensureSuper();
  const body = await readJson(req);
  if (body.projectId != null && typeof body.projectId !== "string") throw badRequest("projectId must be an id.");
  const agent = findStudioAgent(body.agentId);
  if (body.agentId != null && !agent) throw badRequest("Choose an agent from the directory.");
  const chat = newChat(user.id, {
    title: text(body.title, "Title", 80),
    agentId: agent?.id,
    projectId: (body.projectId as string | undefined) ?? null,
    skillIds: idList(body.skillIds, "skillIds", 10),
    incognito: bool(body.incognito, "incognito") ?? false,
  });
  return { chat };
});
