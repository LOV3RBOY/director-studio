import { readJson, route } from "@/server/http";
import { readSkill } from "@/server/super/input";
import { createSkill, listSkills } from "@/server/super/library";

/** GET /api/super/skills  Built-in skills first, then the member's own. */
export const GET = route(({ user }) => ({ skills: listSkills(user.id) }));

/** POST /api/super/skills  { name, description?, instructions } */
export const POST = route(async ({ req, user }) => {
  const s = readSkill(await readJson(req), false);
  return { skill: createSkill(user.id, { name: s.name!, description: s.description ?? "", instructions: s.instructions! }) };
});
