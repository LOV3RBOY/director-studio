import { intParam, route } from "@/server/http";
import { ensureSuper } from "@/server/super/loop";
import { ownedChat, rowsAfter, toChat } from "@/server/super/transcript";

/**
 * GET /api/super/chats/:id/rows?after=<updatedSeq>&limit=
 * Rows changed after `after`, oldest change first. Upsert them by `seq`.
 */
export const GET = route<{ id: string }>(({ req, user, params }) => {
  ensureSuper();
  const chat = ownedChat(user.id, params.id);
  const rows = rowsAfter(chat.id, intParam(req, "after", 0, 0, Number.MAX_SAFE_INTEGER), intParam(req, "limit", 200, 1, 500));
  return { chat: toChat(chat), rows, rev: rows.length ? rows[rows.length - 1].updatedSeq : intParam(req, "after", 0, 0, Number.MAX_SAFE_INTEGER) };
});
