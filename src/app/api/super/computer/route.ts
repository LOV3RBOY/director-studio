import { route } from "@/server/http";
import { computerStatus } from "@/server/super/computer";
import { ensureSuper } from "@/server/super/loop";

/** GET /api/super/computer  The member's cloud computer status. */
export const GET = route(({ user }) => {
  ensureSuper();
  return { computer: computerStatus(user.id) };
});
