import { timingSafeEqual } from "node:crypto";
import { AccountError, createGuest, endSession, logIn, publicUser, signUp, startSession, type User } from "@/server/auth";
import { MILLI } from "@/config/economy";
import { balance, grant } from "@/server/credits";
import { tx } from "@/server/db";
import { badRequest, clientKey, notFound, publicRoute, rateLimit, readJson } from "@/server/http";

const HOUR = 3_600_000;

function privatePilot() {
  const code = process.env.STUDIO_PILOT_CODE;
  const email = process.env.STUDIO_PILOT_EMAIL;
  return process.env.COOKIE_SECURE === "1" && code && /^[a-f0-9]{64}$/.test(code) && email ? { code, email } : null;
}

/** The one address that may sign up and sign in with a password on a private pilot server. */
function ownerEmail() {
  const email = process.env.STUDIO_OWNER_EMAIL?.trim().toLowerCase();
  return email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

const isOwner = (email: unknown) => typeof email === "string" && email.trim().toLowerCase() === ownerEmail();

/** Keeps the owner's balance at the testing allowance. Provider daily budgets still cap real spend. */
function topUpOwner(user: User) {
  const target = Number(process.env.STUDIO_OWNER_CREDITS ?? 10_000);
  if (!Number.isSafeInteger(target) || target <= 0) return;
  tx(() => {
    const missing = target * MILLI - balance(user.id);
    if (missing > 0) grant(user.id, "grant", missing, "Owner testing credits");
  });
}

function pilotCodeMatches(expected: string, supplied: unknown) {
  if (typeof supplied !== "string" || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(supplied, "utf8"));
}

/**
 * POST /api/auth/signup  { email, password, name? }   a guest who signs up keeps their work
 * POST /api/auth/login   { email, password }
 * POST /api/auth/guest                                 a throwaway account, so people can try first
 * POST /api/auth/logout
 */
export const POST = publicRoute<{ action: string }>(async ({ req, user, params }) => {
  const who = clientKey(req);
  const pilot = privatePilot();
  // A private pilot server accepts its pairing code, and a password account only for the owner.
  const ownerOnly = Boolean(process.env.STUDIO_PILOT_CODE);
  if (ownerOnly && !["pilot", "logout", "signup", "login"].includes(params.action)) throw notFound();
  if (ownerOnly && ["signup", "login"].includes(params.action) && !ownerEmail()) throw notFound();
  let next: User | null;
  let body: Record<string, unknown>;
  try {
    switch (params.action) {
      case "pilot":
        if (!pilot) throw notFound();
        rateLimit(`pilot:${who}`, 20, HOUR / 4);
        body = await readJson(req);
        if (!pilotCodeMatches(pilot.code, body.code)) throw notFound();
        try {
          next = logIn({ email: pilot.email, password: pilot.code });
        } catch (err) {
          if (!(err instanceof AccountError)) throw err;
          next = signUp({ email: pilot.email, password: pilot.code, name: "Studio owner" }, null);
        }
        break;
      case "signup":
        rateLimit(`signup:${who}`, 10, HOUR);
        body = await readJson(req);
        if (ownerOnly && !isOwner(body.email)) throw notFound();
        next = signUp({ email: body.email, password: body.password, name: body.name }, user);
        break;
      case "login":
        rateLimit(`login:${who}`, 20, HOUR / 4);
        body = await readJson(req);
        if (ownerOnly && !isOwner(body.email)) throw notFound();
        next = logIn({ email: body.email, password: body.password });
        break;
      case "guest":
        if (!user) rateLimit(`guest:${who}`, 10, HOUR);
        next = user ?? createGuest();
        break;
      case "logout":
        await endSession();
        next = null;
        break;
      default:
        throw notFound();
    }
  } catch (err) {
    if (err instanceof AccountError) throw badRequest(err.message);
    throw err;
  }
  if (next && isOwner(next.email)) topUpOwner(next);
  if (next && next.id !== user?.id) await startSession(next.id);
  return { user: next ? publicUser(next) : null, balance: next ? balance(next.id) : 0 };
});
