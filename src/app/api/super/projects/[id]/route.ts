import { readJson, route } from "@/server/http";
import { listChats } from "@/server/super/chats";
import { readProject } from "@/server/super/input";
import { deleteProject, getProject, updateProject } from "@/server/super/library";

/** GET /api/super/projects/:id  The project and its chats. */
export const GET = route<{ id: string }>(({ user, params }) => ({
  project: getProject(user.id, params.id),
  chats: listChats(user.id, { projectId: params.id, limit: 200 }),
}));

/** PATCH /api/super/projects/:id  { name?, instructions?, fileIds? } */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => ({
  project: updateProject(user.id, params.id, readProject(await readJson(req), true)),
}));

/** DELETE /api/super/projects/:id  Its chats stay, outside any project. */
export const DELETE = route<{ id: string }>(({ user, params }) => {
  deleteProject(user.id, params.id);
  return { ok: true };
});
