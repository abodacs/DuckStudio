import { chromium } from "@playwright/test";

const errors = [];
const target = process.argv[2] ?? "https://slice-6-demo-production.duckstudio.pages.dev/";
const browser = await chromium.launch({
  args: ["--enable-features=WebMCPTesting", "--enable-experimental-web-platform-features"],
});
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) => errors.push("reqfail: " + r.url() + " " + (r.failure()?.errorText ?? "")));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push("http" + r.status() + ": " + r.url());
});
await page.goto(target, { timeout: 60000 });
await page.waitForTimeout(25000);
const state = await page.evaluate(() => ({
  isolated: window.crossOriginIsolated,
  surface: typeof window.__duckstudioAgentSurface,
  title: document.title,
  body: document.body.innerText.slice(0, 200),
}));
console.log("STATE", JSON.stringify(state, null, 1));
console.log("ERRORS", JSON.stringify(errors.slice(0, 12), null, 1));
await browser.close();
