import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const baseUrl = process.env.PLAYTEST_BASE_URL ?? "http://localhost:5173";
const artifactsDir = path.resolve("artifacts", "browser-smoke");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function launchBrowser() {
  const candidates = [
    { channel: "msedge", label: "Microsoft Edge" },
    { channel: "chrome", label: "Google Chrome" },
    { channel: undefined, label: "Bundled Chromium" }
  ];

  const errors = [];
  for (const candidate of candidates) {
    try {
      const browser = await chromium.launch({
        channel: candidate.channel,
        headless: true
      });
      return { browser, label: candidate.label };
    } catch (error) {
      errors.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to launch a browser.\n${errors.join("\n")}`);
}

async function expectVisible(locator) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
}

async function writeReport(report) {
  await fs.writeFile(path.join(artifactsDir, "smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function waitForAppBoot(page) {
  try {
    await expectVisible(page.locator(".hero"));
  } catch (error) {
    const rootText = await page.locator("#root").innerText().catch(() => "");
    const rootHtml = await page.locator("#root").innerHTML().catch(() => "");
    await page.screenshot({ path: path.join(artifactsDir, "00-boot-failure.png"), fullPage: true });
    await fs.writeFile(path.join(artifactsDir, "boot-failure.html"), `rootText:\n${rootText}\n\nrootHtml:\n${rootHtml}\n`, "utf8");
    throw new Error(`Landing UI did not render. Original error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  await ensureDir(artifactsDir);
  const { browser, label } = await launchBrowser();
  console.log(`browser launch ok: ${label}`);

  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const report = {
    baseUrl,
    browser: label,
    landing: {},
    lobby: {},
    room: {}
  };

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
    await waitForAppBoot(page);
    await expectVisible(page.locator(".home-grid"));
    await expectVisible(page.getByRole("heading", { name: "用户名登录" }));
    await expectVisible(page.getByRole("heading", { name: "当前房间" }));
    await page.screenshot({ path: path.join(artifactsDir, "01-landing.png"), fullPage: true });

    await page.getByRole("textbox", { name: "用户名" }).fill("SoloSmoke");
    await page.getByRole("button", { name: "登录 / 继续" }).click();
    await expectVisible(page.getByText("总场次", { exact: false }));

    await page.getByRole("button", { name: "创建房间" }).click();
    await expectVisible(page.locator(".room-layout"));
    await expectVisible(page.locator(".seat-panel"));
    await expectVisible(page.locator(".board-panel"));
    await page.screenshot({ path: path.join(artifactsDir, "02-lobby.png"), fullPage: true });

    const debugFillButton = page.getByRole("button", { name: "一键补 3 个测试位" });
    await expectVisible(debugFillButton);
    await debugFillButton.click();
    await expectVisible(page.getByText("测试位 A"));
    await page.screenshot({ path: path.join(artifactsDir, "03-debug-filled.png"), fullPage: true });

    await page.getByRole("button", { name: "开始对局" }).click();
    const cardTiles = page.locator(".card-tile");
    await expectVisible(cardTiles.first());
    const cardCount = await cardTiles.count();
    if (cardCount !== 25) {
      throw new Error(`Expected 25 cards, got ${cardCount}`);
    }

    await expectVisible(page.locator(".right-column"));
    await page.screenshot({ path: path.join(artifactsDir, "04-board.png"), fullPage: true });

    await page.getByRole("button", { name: "专注模式" }).click();
    await expectVisible(page.getByRole("button", { name: "退出专注模式" }));
    await page.screenshot({ path: path.join(artifactsDir, "05-focus-mode.png"), fullPage: true });

    report.landing = {
      hasAccountPanel: true,
      hasLobbyPanel: true
    };
    report.lobby = {
      hasRoomSettings: true,
      hasBoardWorkbench: true
    };
    report.room = {
      cardCount,
      hasFocusMode: true
    };

    await writeReport(report);
    console.log("browser smoke ok");
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
