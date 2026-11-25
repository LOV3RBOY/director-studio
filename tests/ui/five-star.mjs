// Five Star walk-through: saved cast (you + a friend), Photo then Make it move, Video (still chains
// into a clip on its own), three shots fill the reel, the trailer plays.
import { launch } from "./browser.mjs";

const [base, out, W = "393", H = "852"] = process.argv.slice(2);
const b = await launch({ width: Number(W), height: Number(H), out });
const face = (hue) => `(async () => {
  const c = document.createElement("canvas"); c.width = 300; c.height = 400; const x = c.getContext("2d");
  x.fillStyle = "hsl(${hue} 40% 60%)"; x.fillRect(0, 0, 300, 400); x.fillStyle = "#3b2a22"; x.beginPath(); x.arc(150, 170, 80, 0, 7); x.fill();
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const f = new FormData(); f.append("file", blob, "face.png"); f.append("accept", "image");
  const j = await (await fetch("/api/assets", { method: "POST", body: f })).json();
  return { id: j.asset.id, url: j.asset.url, posterUrl: j.asset.posterUrl, kind: "image" };
})()`;
const videoCount = `document.querySelectorAll('section[aria-label="Trailer"] video').length`;

try {
  await b.goto(`${base}/five-star`);
  await b.until(`document.querySelectorAll('[data-starter]').length === 6`, 30000, "starters");
  await b.sleep(500);
  await b.shot("00-signed-out", { full: true });
  await b.evaluate(`fetch("/api/auth/guest", { method: "POST" }).then((r) => r.status)`);
  await b.evaluate(`fetch("/api/wallet/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packId: "pack-2000" }) }).then((r) => r.status)`);
  const you = await b.evaluate(face(25));
  const friend = await b.evaluate(face(200));
  await b.evaluate(`localStorage.setItem("fivestar.cast.v2", JSON.stringify({ you: [${JSON.stringify(you)}], crew: [${JSON.stringify(friend)}] }))`);
  await b.goto(`${base}/five-star`);
  await b.until(`document.querySelectorAll('[data-starter]').length === 6 && !!document.querySelector('img[alt="You"]') && !!document.querySelector('img[alt="Friend"]')`, 30000, "cast loaded");
  await b.sleep(600);
  await b.shot("01-start", { full: true });

  // Photo, then Make it move.
  if (!(await b.evaluate(`document.querySelector('[data-run="make"]').disabled`))) throw new Error("Make should wait for a scene");
  await b.click('[data-starter="chase"]');
  await b.until(`!document.querySelector('[data-run="make"]').disabled`, 10000, "make enabled");
  await b.click('[data-run="make"]');
  await b.until(`document.querySelector('[data-result]')?.dataset.result === "photo" && !!document.querySelector('[data-run="move"]')`, 60000, "photo");
  await b.sleep(500);
  await b.shot("02-photo", { full: true });
  await b.click('[data-run="move"]');
  await b.until(`document.querySelector('[data-result]')?.dataset.result === "video"`, 90000, "clip from photo");

  // Video mode: one press makes the still, then the clip.
  await b.click('[data-option="video"]');
  for (const sc of ["beach", "penthouse"]) {
    const before = await b.evaluate(videoCount);
    await b.click(`[data-starter="${sc}"]`);
    await b.until(`!document.querySelector('[data-run="make"]').disabled`, 20000, "make enabled");
    await b.click('[data-run="make"]');
    await b.until(`${videoCount} > ${before} && document.querySelector('[data-result]')?.dataset.result === "video"`, 150000, `video for ${sc}`);
  }
  await b.until(`!!document.querySelector('[data-run="trailer"]')`, 20000, "trailer button");
  await b.sleep(800);
  await b.shot("03-reel", { full: true });
  await b.click('[data-run="trailer"]');
  await b.sleep(1500);
  await b.shot("04-trailer-playing");
  const errors = b.logs().filter((l) => !l.startsWith("warning"));
  if (errors.length) throw new Error(`console: ${errors.join(" | ").slice(0, 600)}`);
  console.log("OK");
} catch (e) {
  console.log("FAIL", e.message);
  process.exitCode = 1;
  await b.shot("fail", { full: true });
  console.log(JSON.stringify(b.logs()).slice(0, 1500));
}
await b.close();
