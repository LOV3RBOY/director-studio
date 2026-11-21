import { readJson, route } from "@/server/http";
import { deleteChat, patchChat } from "@/server/super/chats";
import { readChatPatch } from "@/server/super/input";
import { ensureSuper, listTurns } from "@/server/super/loop";
import { ownedChat, toChat } from "@/server/super/transcript";

/** GET /api/super/chats/:id  The chat and its recent turns. Read rows from /rows. */
export const GET = route<{ id: string }>(({ user, params }) => {
  ensureSuper();
  return { chat: toChat(ownedChat(user.id, params.id)), turns: listTurns(user.id, params.id) };
});

/** PATCH /api/super/chats/:id  { title?, pinned?, projectId?, skillIds? } */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => {
  ensureSuper();
  return { chat: patchChat(user.id, params.id, readChatPatch(await readJson(req))) };
});

/** DELETE /api/super/chats/:id  Stops any running turn and removes the chat with its transcript. */
export const DELETE = route<{ id: string }>(({ user, params }) => {
  ensureSuper();
  deleteChat(user.id, params.id);
  return { ok: true };
});
