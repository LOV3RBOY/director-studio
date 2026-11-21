import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { ApiError, notFound, publicRoute, readJson, type AuthedCtx } from "@/server/http";
import { applyPurchase, commerceAvailable, handleStoreNotification, purchaseOptions } from "@/server/director/commerce";
import { chatInput, guidance, identifier, imageInput, learnInput, packInput, projectsInput, renderInput, valid } from "@/server/director/contracts";
import { exportFile, ingest, renderQuote, requestRender } from "@/server/director/delivery";
import { gradeTake, queueFidelity, renderReview } from "@/server/director/fidelity";
import { imageAttempts, imageQuote, requestImage } from "@/server/director/images";
import { evidenceFrame } from "@/server/director/media";
import { directorModels } from "@/server/director/models";
import { tregMode } from "@/server/treg";
import { directorMode } from "@/server/director/runtime";
import {
  currentPack, evidenceFor, listProjects, listStyles, markPackReviewed, ownedJob, projectDetail, projectRow, queue, reanalyzeStyle,
  retryPlan, saveStyle, snapshot, startProject, startStyle, styleDetail, toJob, writePack,
} from "@/server/director/store";
import { ensureDirectorWorker } from "@/server/director/worker";

type Params = { parts: string[] };
const authed = (ctx: { user: AuthedCtx<Params>["user"] | null }) => {
  if (!ctx.user || ctx.user.isGuest) throw new ApiError(401, "unauthorized", "Sign in with an account to use Director Studio.");
  return ctx.user;
};

const readIndex = (raw: string | undefined, max = 49) => valid(z.coerce.number().int().min(0).max(max), raw);

export const GET = publicRoute<Params>(async (ctx) => {
  const [surface, rawId, action, rawIndex, extra] = ctx.params.parts;
  if (surface === "ingest" && ctx.params.parts.length === 3) {
    return ingest(valid(identifier, rawId), valid(identifier, action), ctx.req);
  }
  const userId = authed(ctx).id;
  const mode = directorMode();
  ensureDirectorWorker();
  if (surface === "status" && ctx.params.parts.length === 1) return { mode, commerce: commerceAvailable() };
  if (surface === "store" && ctx.params.parts.length === 1) return purchaseOptions(userId);
  if (surface === "styles" && ctx.params.parts.length === 1) return { styles: listStyles(userId) };
  if (surface === "projects" && ctx.params.parts.length === 1) return { projects: listProjects(userId) };
  if (surface === "models" && ctx.params.parts.length === 1) {
    // Frame models render through the shared pipeline, which must run in the same mode.
    return { models: directorModels().map((item) => ({ ...item, available: item.engine === "omni" || tregMode() === mode })) };
  }
  const id = valid(identifier, rawId);
  if (surface === "styles") {
    if (ctx.params.parts.length === 2) return styleDetail(userId, id);
    if (action === "frames" && ctx.params.parts.length === 5) {
      const ordinal = readIndex(extra);
      const { asset, evidence } = evidenceFor(userId, id, valid(identifier, rawIndex), ordinal);
      return new Response(new Uint8Array(await evidenceFrame(asset, evidence, ordinal)), {
        headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
      });
    }
  }
  if (surface === "projects" && ctx.params.parts.length === 2) return projectDetail(userId, id);
  if (surface === "renders" && action === "fidelity" && ctx.params.parts.length === 3) return renderReview(userId, id);
  if (surface === "packs") {
    if (ctx.params.parts.length === 2) return { pack: snapshot(userId, id).pack };
    if (action === "quote" && ctx.params.parts.length === 4) return renderQuote(userId, id, readIndex(rawIndex, 11));
    if (action === "image-quote" && ctx.params.parts.length === 4) return imageQuote(userId, id, readIndex(rawIndex, 19));
    if (action === "images" && ctx.params.parts.length === 3) return { images: imageAttempts(userId, id) };
  }
  if (surface === "jobs") {
    const row = ownedJob(userId, id);
    if (ctx.params.parts.length === 2) return { job: toJob(row) };
    if (action === "file" && ctx.params.parts.length === 3 && row.kind === "export" && row.state === "succeeded") {
      const file = exportFile(userId, id);
      const stat = statSync(file, { throwIfNoEntry: false });
      if (!stat?.isFile()) throw notFound("The export file is missing. Request a fresh export.");
      const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
      return new Response(stream, { headers: {
        "content-type": "application/zip", "content-disposition": 'attachment; filename="director-project-pack.zip"',
        "content-length": String(stat.size), "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      } });
    }
  }
  throw notFound();
});

const styleEdit = z.object({ previousId: identifier, guide: guidance.shape.guide, rules: guidance.shape.rules.optional() });

const gradeInput = z.object({ strength: z.number().gt(0).max(1).default(0.6), grain: z.boolean().default(true) });

const signedValue = z.string().max(160_000).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export const POST = publicRoute<Params>(async (ctx) => {
  const [surface, rawId, action] = ctx.params.parts;
  const count = ctx.params.parts.length;
  directorMode();
  if (surface === "store" && rawId === "notifications" && count === 2) {
    const value = valid(z.object({ signedPayload: signedValue }), await readJson(ctx.req));
    await handleStoreNotification(value.signedPayload);
    return { received: true };
  }
  const user = authed(ctx);
  ensureDirectorWorker();
  const body = await readJson(ctx.req);
  if (surface === "store" && rawId === "transactions" && count === 2) {
    const value = valid(z.object({ signedTransaction: signedValue }), body);
    return applyPurchase(user.id, value.signedTransaction);
  }
  if (surface === "styles" && count === 1) return startStyle(user.id, valid(learnInput, body));
  if (surface === "projects" && count === 1) return startProject(user.id, valid(projectsInput, body));
  const id = valid(identifier, rawId);
  if (surface === "styles" && count === 3) {
    if (action === "save") return { version: await saveStyle(user.id, id, valid(styleEdit, body)) };
    if (action === "retry") return { job: reanalyzeStyle(user.id, id) };
  }
  if (surface === "projects" && count === 3) {
    if (action === "plan") return { job: retryPlan(user.id, id) };
    if (action === "chat") {
      const project = projectRow(user.id, id);
      return { job: toJob(queue({ userId: user.id, kind: "chat", projectId: project.id, body: valid(chatInput, body) })) };
    }
    if (action === "pack") {
      const edit = valid(packInput, body);
      if (!currentPack(user.id, id)) throw notFound("This project has no storyboard yet.");
      return { pack: writePack(user.id, id, edit.plan, edit.settings, edit.previousId) };
    }
  }
  if (surface === "renders" && count === 3) {
    if (action === "fidelity") return { fidelity: queueFidelity(user.id, id) };
    if (action === "grade") {
      const input = valid(gradeInput, body);
      return { grade: await gradeTake(user.id, id, input.strength, input.grain) };
    }
  }
  if (surface === "packs" && count === 3) {
    if (action === "review") return markPackReviewed(user.id, id);
    if (action === "render") return { job: requestRender(user, id, valid(renderInput, body)) };
    if (action === "images") return requestImage(user, id, valid(imageInput, body));
    if (action === "export") {
      const { project, pack } = snapshot(user.id, id);
      return { job: toJob(queue({ userId: user.id, kind: "export", projectId: project.id, snapshotId: pack.id, body: {} })) };
    }
  }
  throw notFound();
});
