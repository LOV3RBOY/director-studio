import { route } from "@/server/http";
import { openStream } from "@/server/super/hub";
import { ensureSuper } from "@/server/super/loop";

/** GET /api/super/events  The member's Server-Sent Events stream for every chat. */
export const GET = route(({ req, user }) => {
  ensureSuper();
  return openStream(user.id, req.signal);
});
