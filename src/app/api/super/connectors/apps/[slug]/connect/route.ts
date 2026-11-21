import { route } from "@/server/http";
import { publicOrigin } from "@/server/origin";
import { startConnect } from "@/server/super/connectors";

/** POST /api/super/connectors/apps/:slug/connect  Answers with the sign-in link to open. */
export const POST = route<{ slug: string }>(async ({ req, user, params }) => startConnect(user.id, params.slug, publicOrigin(req)));
