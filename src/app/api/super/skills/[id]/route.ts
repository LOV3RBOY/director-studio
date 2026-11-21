import { readJson, route } from "@/server/http";
import { readSkill } from "@/server/super/input";
import { deleteSkill, updateSkill } from "@/server/super/library";

/** PATCH /api/super/skills/:id  { name?, description?, instructions? }  Custom skills only. */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => ({
  skill: updateSkill(user.id, params.id, readSkill(await readJson(req), true)),
}));

/** DELETE /api/super/skills/:id */
export const DELETE = route<{ id: string }>(({ user, params }) => {
  deleteSkill(user.id, params.id);
  return { ok: true };
});
