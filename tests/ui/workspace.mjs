import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { launch, scenario } from "./browser.mjs";

const [base, out, W = "390", H = "844"] = process.argv.slice(2);
const b = await launch({ width: Number(W), height: Number(H), out });
const workspace = 'nav[aria-label="Studio workspace"]';
const picker = 'button[aria-label^="Model: "]';
const dialog = '[role="dialog"]';

async function api(path, body) {
  const response = await b.evaluate(`fetch(${JSON.stringify(path)}, ${JSON.stringify(body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : {})}).then(async (r) => ({ status: r.status, data: await r.json() }))`);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
}

async function pick(name) {
  await b.click(picker);
  await b.until('!!document.querySelector(\'[role="menuitemradio"]\')');
  await b.click('[role="menuitemradio"]', name);
  await b.until(`document.querySelector(${JSON.stringify(picker)})?.getAttribute("aria-label") === ${JSON.stringify("Model: " + name)}`);
}

let ok = false;
try {
  ok = await scenario(b, [
    ["fresh Cinema drafts keep independent still and video models", async () => {
      await b.goto(`${base}/studio`);
      await api("/api/auth/signup", { email: "workspace@example.test", password: "fixture-password", name: "Workspace Tester" });
      await b.reload();
      await b.click('main a[href="/cinema"]');
      await b.until('location.pathname === "/cinema" && !!document.querySelector(\'button[aria-label^="Model:"]\')');
      await b.until(`!!document.querySelector(${JSON.stringify(picker + ":not(:disabled)")})`);
      const catalog = await api("/api/cinema/catalog");
      const still = catalog.models.still.find((m) => m.id !== catalog.defaults.stillModelId && m.id === "flux-schnell");
      const motion = catalog.models.video.find((m) => m.id !== catalog.defaults.videoModelId && m.canAnimate && m.canTextToVideo);
      assert.ok(still && motion);
      await pick(still.name);
      await b.click('[role="radio"]', "Video");
      await pick(motion.name);
      await b.click('[role="radio"]', "Image");
      await b.until(`document.querySelector(${JSON.stringify(picker)})?.getAttribute("aria-label") === ${JSON.stringify("Model: " + still.name)}`);
      await b.shot("01-cinema-models");
      await b.click("textarea");
      await b.type("A ceramic bird on a pedestal");
      await b.key("Enter");
      await b.until('!!document.querySelector(\'ul[aria-label="Takes"] li img\')', 45000, "a first still");
      const projects = (await api("/api/cinema/projects")).projects;
      assert.equal(projects[0].stillModelId, still.id);
      assert.equal(projects[0].videoModelId, motion.id);
      const replacement = catalog.models.still.find((m) => m.id === catalog.defaults.stillModelId);
      await pick(replacement.name);
      await b.until(`fetch("/api/cinema/projects").then(r => r.json()).then(data => data.projects[0].stillModelId === ${JSON.stringify(replacement.id)})`);
    }],
    ["Director offers scoped navigation and keeps its conversation as you go back", async () => {
      await b.click(`${workspace} button`, "Director");
      await b.until('!!document.querySelector(\'[role="dialog"] #super-prompt\')');
      await b.click(`${dialog} #super-prompt`);
      await b.type("Open Style Library");
      await b.click(`${dialog} button[aria-label="Send message"]`);
      await b.until('!!document.querySelector(\'[role="dialog"] a[href="/style-library"].ooo-primary\')', 20000, "Director navigation card");
      await b.shot("02-director-dock");
      await b.click(`${dialog} a.ooo-primary[href="/style-library"]`);
      await b.until('location.pathname === "/style-library" && !document.querySelector(\'[role="dialog"]\')');
      await b.click(`${workspace} button`, "Back");
      await b.until('location.pathname === "/cinema"');
      await b.click(`${workspace} button`, "Director");
      await b.until('!!document.querySelector(\'[role="dialog"] a.ooo-primary[href="/style-library"]\')');
      await b.key("Escape");
      await b.until('!document.querySelector(\'[role="dialog"]\')');
    }],
    ["upload, study, save and reuse a reference without losing its evidence", async () => {
      await b.goto(`${base}/style-library`);
      await b.until('!!document.querySelector(\'input[type="file"]\')');
      const reference = resolve(out, "style-reference.png");
      execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=blue:size=128x72", "-threads", "1", "-frames:v", "1", reference]);
      const { root } = await b.send("DOM.getDocument");
      const { nodeId } = await b.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
      await b.send("DOM.setFileInputFiles", { nodeId, files: [reference] });
      await b.click('input[name="title"]');
      await b.type("Blue hour");
      await b.click('textarea[name="notes"]');
      await b.type("Keep the cool palette. Study the framing.");
      await b.click("button", "Analyze reference");
      await b.until('location.search.includes("style=") && !!document.querySelector(\'textarea[name="guide"]\')', 45000, "finished analysis");
      const styleId = await b.evaluate('new URLSearchParams(location.search).get("style")');
      const draft = (await api(`/api/director/styles/${styleId}`)).versions[0];
      assert.equal(draft.profile.rules.length >= 14, true);
      assert.equal(draft.profile.evidence.width, 128);
      const frame = await b.evaluate(`fetch("/api/director/styles/${styleId}/frames/${draft.id}/0").then(r => [r.status, r.headers.get("content-type")])`);
      assert.deepEqual(frame, [200, "image/jpeg"]);
      await b.click("button", "Save style");
      await b.until('!!document.querySelector(\'textarea[name="brief"]\')', 15000, "reuse form");
      const saved = (await api(`/api/director/styles/${styleId}`)).versions[0];
      assert.equal(saved.saved, true);
      await b.shot("03-style-library");
      await b.click('form:has(textarea[name="brief"]) input[name="title"]');
      await b.type("Glass city");
      await b.click('textarea[name="brief"]');
      await b.type("A courier carrying a red flask crosses a glass city at dawn.");
      await b.click("button", "Create styled project");
      await b.until('location.search.includes("project=") && !!document.querySelector(\'a[href^="/cinema?project="]\')', 45000, "finished storyboard");
      const projectId = await b.evaluate('new URLSearchParams(location.search).get("project")');
      const project = await api(`/api/director/projects/${projectId}`);
      assert.equal(project.pinnedStyle.id, saved.id);
      assert.equal(project.pack.body.clips.length > 0, true);
      await b.click('a[href^="/cinema?project="]');
      await b.until('location.pathname === "/cinema" && document.querySelector("h1")?.textContent.includes("Glass city")', 20000, "the correct storyboard");
    }],
    ["workspace stays within the viewport", async () => {
      assert.ok(await b.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
      assert.ok(await b.evaluate('document.documentElement.scrollHeight <= innerHeight + 1'));
    }],
  ]);
} finally {
  await b.close();
}
if (!ok) process.exitCode = 1;
