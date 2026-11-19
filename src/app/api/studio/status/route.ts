import { route } from "@/server/http";
import { hermesEngine } from "@/server/super/config";
import { tregMode } from "@/server/treg";

export const GET = route(() => ({
  media: tregMode(),
  crew: hermesEngine() ? "hermes" : "built-in",
}));
