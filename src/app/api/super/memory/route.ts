import { route } from "@/server/http";
import { listMemories } from "@/server/super/library";

/** GET /api/super/memory  What the assistant remembers about the member, newest first. */
export const GET = route(({ user }) => ({ memories: listMemories(user.id) }));
