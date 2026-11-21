import { publicRoute } from "@/server/http";
import { SHOWCASE } from "@/server/super/library";

/** GET /api/super/showcase  Example prompts for the home screen. Works signed out. */
export const GET = publicRoute(() => ({ items: SHOWCASE, categories: ["All", ...new Set(SHOWCASE.map((s) => s.category))] }));
