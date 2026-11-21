import { readJson, route } from "@/server/http";
import { readProject } from "@/server/super/input";
import { createProject, listProjects } from "@/server/super/library";

/** GET /api/super/projects */
export const GET = route(({ user }) => ({ projects: listProjects(user.id) }));

/** POST /api/super/projects  { name, instructions?, fileIds? } */
export const POST = route(async ({ req, user }) => {
  const p = readProject(await readJson(req), false);
  return { project: createProject(user.id, { name: p.name!, instructions: p.instructions ?? "", fileIds: p.fileIds ?? [] }) };
});
