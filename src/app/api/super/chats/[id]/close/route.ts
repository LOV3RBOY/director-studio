import { route } from "@/server/http";
import { closeChat } from "@/server/super/chats";
import { ensureSuper } from "@/server/super/loop";

/** POST /api/super/chats/:id/close  An incognito chat is deleted when closed. */
export const POST = route<{ id: string }>(({ user, params }) => {
  ensureSuper();
  return closeChat(user.id, params.id);
});
