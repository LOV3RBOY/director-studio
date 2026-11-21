import { readJson, route } from "@/server/http";
import { ensureSuper } from "@/server/super/loop";
import { checkInterval, createSchedule, listSchedules } from "@/server/super/schedules";
import { text } from "@/server/super/util";

/** GET /api/super/schedules */
export const GET = route(({ user }) => {
  ensureSuper();
  return { schedules: listSchedules(user.id) };
});

/** POST /api/super/schedules  { title, prompt, intervalMinutes, runNow? } */
export const POST = route(async ({ req, user }) => {
  ensureSuper();
  const body = await readJson(req);
  return {
    schedule: createSchedule(user.id, {
      title: text(body.title, "Title", 80, { required: true }),
      prompt: text(body.prompt, "Prompt", 4_000, { required: true }),
      intervalMinutes: checkInterval(body.intervalMinutes),
      firstRunAt: body.runNow === true ? Date.now() : undefined,
    }),
  };
});
