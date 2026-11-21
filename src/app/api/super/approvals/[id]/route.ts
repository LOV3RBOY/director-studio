import { readJson, route } from "@/server/http";
import { answerCard, ensureSuper } from "@/server/super/loop";

/** POST /api/super/approvals/:id  { decision: "allow"|"always"|"deny" } or { choice } for a question. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  ensureSuper();
  const body = await readJson(req);
  return answerCard(user.id, params.id, { decision: body.decision, choice: body.choice });
});
