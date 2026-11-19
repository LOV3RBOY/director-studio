import assert from "node:assert/strict";
import { launch, scenario } from "./browser.mjs";

const [base, out, width = "390", height = "844"] = process.argv.slice(2);
const browser = await launch({ width: Number(width), height: Number(height), out });

function checkTextContrast(selector) {
  const elements = [...document.querySelectorAll(selector)].filter((el) => el.getClientRects().length);
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (color) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const blend = (front, back) => back.map((channel, i) => front[i] * front[3] + channel * (1 - front[3]));
  const luminance = (rgb) => rgb.reduce((l, channel, i) => {
    const v = channel / 255;
    return l + [0.2126, 0.7152, 0.0722][i] * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  }, 0);
  return elements.map((el) => {
    const styles = [];
    for (let node = el; node; node = node.parentElement) styles.unshift(getComputedStyle(node));
    const backgrounds = styles.reduce((behind, style) => {
      const surface = behind.map((back) => blend(rgba(style.backgroundColor), back));
      // Check both ends and any additional stops of a simple CSS gradient.
      const colors = style.backgroundImage.match(/rgba?\([^)]+\)/g);
      return colors ? colors.flatMap((color) => surface.map((back) => blend(rgba(color), back))) : surface;
    }, [[255, 255, 255]]);
    const ink = rgba(getComputedStyle(el).color);
    const ratios = backgrounds.map((background) => {
      const values = [luminance(background), luminance(blend(ink, background))].sort((a, b) => b - a);
      return Number(((values[0] + 0.05) / (values[1] + 0.05)).toFixed(2));
    });
    return { text: el.textContent.trim().slice(0, 60), ratio: Math.min(...ratios) };
  });
}

async function contrast(selector) {
  const results = await browser.evaluate(`(${checkTextContrast})(${JSON.stringify(selector)})`);
  assert.ok(results.length, `Missing text elements for ${selector}`);
  for (const item of results) assert.ok(item.ratio >= 4.5, `${item.text} has ${item.ratio}:1 contrast`);
  return `minimum ${Math.min(...results.map((item) => item.ratio))}:1`;
}

async function post(path, body) {
  const response = await browser.evaluate(`fetch(${JSON.stringify(path)}, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: ${JSON.stringify(JSON.stringify(body))}
  }).then(async (res) => ({ status: res.status, data: await res.json() }))`);
  assert.ok(response.status < 300, `${path} returned ${response.status}`);
  return response.data;
}

let passed = false;
try {
  passed = await scenario(browser, [
    ["Studio hub links to production, agents, uploads, and Notifications", async () => {
      await browser.goto(`${base}/studio`);
      const { user } = await post("/api/auth/signup", {
        email: `polish-${Date.now()}@example.com`,
        name: "Studio test",
        password: "Studio-QA-local-only-3492!",
      });
      assert.ok(user?.id);
      await browser.reload();
      assert.equal(await browser.evaluate('document.querySelectorAll("a.ooo-tool").length'), 9);
      await browser.shot("01-studio");
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
      await browser.click('a[href="/agents"]');
      await browser.until('location.pathname === "/agents"');
      await browser.until(`document.querySelectorAll('a.ooo-tool[href^="/agents/"]').length === 6`);
      await browser.shot("02-agents");
    }],
    ["Hermes chat renders both messages with readable ink", async () => {
      const { chat } = await post("/api/super/chats", { title: "Contrast check", agentId: "director" });
      await browser.goto(`${base}/supercomputer/c/${chat.id}`);
      await browser.click("#super-prompt");
      await browser.type("Give me one idea for a tabletop film.");
      await browser.click('button[aria-label="Send message"]');
      await browser.until('document.querySelector(\'[data-assistant-reply] p[aria-busy="false"]\')?.textContent.trim().length > 0', 30000, "a completed reply");
      await browser.shot("03-chat");
      return contrast("[data-assistant-reply] p, .ooo-user-note");
    }],
    ["Mobile chat menu supports Escape and restores focus", async () => {
      if (Number(width) >= 1024) return "desktop sidebar";
      const menu = 'button[aria-label="Open menu"]';
      await browser.click(menu);
      await browser.until('!!document.querySelector("[role=dialog]")');
      await browser.key("Escape");
      await browser.until('!document.querySelector("[role=dialog]")');
      assert.equal(await browser.evaluate(`document.activeElement.matches(${JSON.stringify(menu)})`), true);
    }],
    ["Notifications filters, rows and preferences stay legible", async () => {
      await post("/api/jobs", { modelId: "flux-schnell", prompt: "A terracotta cup in a quiet studio" });
      await browser.goto(`${base}/notifications`);
      await browser.until('!!document.querySelector("[data-notice]") && !!document.querySelector("[role=switch]")', 30000, "notification and preferences");
      await browser.shot("04-inbox");
      const initial = await contrast(".ooo-filter, [data-notice] button > span, aside label > span");
      await browser.click(".ooo-filter", "Unread");
      await browser.until('document.querySelector(\'.ooo-filter[aria-pressed="true"]\')?.textContent === "Unread"');
      await browser.click("button", "Mark all read");
      await browser.until('!document.querySelector(\'[data-notice][data-read="false"]\')');
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
      return initial;
    }],
  ]);
} finally {
  await browser.close();
}
if (!passed) process.exitCode = 1;
