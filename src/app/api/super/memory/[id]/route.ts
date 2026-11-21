import { route } from "@/server/http";
import { deleteMemory } from "@/server/super/library";

/** DELETE /api/super/memory/:id */
export const DELETE = route<{ id: string }>(({ user, params }) => {
  deleteMemory(user.id, params.id);
  return { ok: true };
});
