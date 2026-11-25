// Five Star walk-through: saved character, scene, still, Make it move, three shots fill the reel, trailer plays.
import { launch } from "./browser.mjs";
const [base, out, W = "393", H = "852"] = process.argv.slice(2);
const b = await launch({ width: Number(W), height: Number(H), out });
try {
  await b.goto(`${base}/five-star`);
  await b.evaluate(`fetch("/api/auth/guest", { method: "POST" }).then((r) => r.status)`);
  console.log("topup", await b.evaluate(`fetch("/api/wallet/topup", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({packId:"pack-2000"}) }).then((r) => r.status)`));
  // a selfie stand-in, uploaded the same way the page uploads
  const asset = await b.evaluate(`(async () => {
    const c = document.createElement("canvas"); c.width = 300; c.height = 400; const x = c.getContext("2d");
    const g = x.createLinearGradient(0,0,0,400); g.addColorStop(0,"#d9a47a"); g.addColorStop(1,"#6b4a3a"); x.fillStyle = g; x.fillRect(0,0,300,400);
    x.fillStyle="#3b2a22"; x.beginPath(); x.arc(150,170,80,0,7); x.fill();
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const f = new FormData(); f.append("file", blob, "selfie.png"); f.append("accept", "image");
    const r = await fetch("/api/assets", { method: "POST", body: f }); const j = await r.json();
    localStorage.setItem("fivestar.character.v1", JSON.stringify([{id:j.asset.id,url:j.asset.url,posterUrl:j.asset.posterUrl,kind:"image"}]));
    return j.asset.id; })()`);
  await b.goto(`${base}/five-star`);
  await b.until(`document.querySelectorAll('[data-scene]').length === 6`, 30000, "scenes");
  await b.sleep(800);
  await b.shot("01-start", { full: true });
  for (const [i, sc] of ["chase", "beach", "penthouse"].entries()) {
    await b.click(`[data-scene="${sc}"]`);
    await b.until(`!document.querySelector('[data-run="still"]').disabled`, 10000, "run enabled");
    await b.click('[data-run="still"]');
    await b.until(`!!document.querySelector('[data-result="still"] img')`, 60000, "still");
    await b.until(`!!document.querySelector('[data-run="motion"]')`, 20000, "make it move");
    if (i === 0) { await b.sleep(500); await b.shot("02-still", { full: true }); }
    await b.click('[data-run="motion"]');
    await b.until(`!!document.querySelector('[data-result="motion"] video')`, 90000, "clip");
  }
  await b.until(`!!document.querySelector('[data-run="trailer"]')`, 20000, "trailer button");
  await b.sleep(800);
  await b.shot("03-reel", { full: true });
  await b.click('[data-run="trailer"]');
  await b.sleep(1500);
  await b.shot("04-trailer-playing");
  const errs = b.logs(); console.log("logs:", JSON.stringify(errs).slice(0, 800));
  console.log("OK", asset);
} catch (e) { console.log("FAIL", e.message); process.exitCode = 1; await b.shot("fail", { full: true }); console.log(JSON.stringify(b.logs()).slice(0,1500)); }
await b.close();
