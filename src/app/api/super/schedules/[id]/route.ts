import { readJson, route } from "@/server/http";
import { ensureSuper } from "@/server/super/loop";
import { checkInterval, deleteSchedule, updateSchedule } from "@/server/super/schedules";
import { bool, text } from "@/server/super/util";

/** PATCH /api/super/schedules/:id  { title?, prompt?, intervalMinutes?, enabled?, runNow? } */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => {
  ensureSuper();
  const b = await readJson(req);
  return {
    schedule: updateSchedule(user.id, params.id, {
      title: b.title === undefined ? undefined : text(b.title, "Title", 80, { required: true }),
      prompt: b.prompt === undefined ? undefined : text(b.prompt, "Prompt", 4_000, { required: true }),
      intervalMinutes: b.intervalMinutes === undefined ? undefined : checkInterval(b.intervalMinutes),
      enabled: bool(b.enabled, "enabled"),
      runNow: bool(b.runNow, "runNow"),
    }),
  };
});

/** DELETE /api/super/schedules/:id  The chat it posted into stays. */
export const DELETE = route<{ id: string }>(({ user, params }) => {
  deleteSchedule(user.id, params.id);
  return { ok: true };
});
