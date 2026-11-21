import { route } from "@/server/http";
import { ensureSuper, stopChat } from "@/server/super/loop";

/** POST /api/super/chats/:id/stop  Stops the running turn and drops queued ones. */
export const POST = route<{ id: string }>(({ user, params }) => {
  ensureSuper();
  return stopChat(user.id, params.id);
});
