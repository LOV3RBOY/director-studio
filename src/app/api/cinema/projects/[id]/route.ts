import { pump } from "@/server/cinema/batch";
import { deleteProject, toProject, updateProject } from "@/server/cinema/store";
import { storyboard } from "@/server/cinema/storyboard";
import { get } from "@/server/db";
import { mode } from "@/server/director/runtime";
import { readJson, route } from "@/server/http";

/** GET /api/cinema/projects/:id  The storyboard: project, cast, scenes, shots, selected takes, running time. */
export const GET = route<{ id: string }>(({ user, params }) => {
  pump();
  const board = storyboard(user.id, params.id);
  const director = mode();
  const hasStyleProof = !!director && !!get<{ id: string }>(
    "SELECT id FROM director_projects WHERE id = ? AND user_id = ? AND mode = ?",
    params.id, user.id, director,
  );
  return { ...board, hasStyleProof };
});

/** PATCH /api/cinema/projects/:id  Any of { title, logline, aspect, look, stillModelId, videoModelId } */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => ({ project: toProject(updateProject(user.id, params.id, await readJson(req))) }));

/** DELETE /api/cinema/projects/:id  Generated files stay in the library. */
export const DELETE = route<{ id: string }>(({ user, params }) => {
  deleteProject(user.id, params.id);
  return { ok: true };
});
