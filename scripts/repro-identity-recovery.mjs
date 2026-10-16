// Regression repro for the 2026-10-16 production incident:
//  - a 2xx login response whose body could not be read was silently treated as `{}`,
//    poisoning the local identity into `{"mode":"named"}` (username lost), after which
//    every page load auto-retried `POST /api/users/login {}` and the server replied
//    400 "username 参数无效" (login/profile pages unusable).
// Scenarios:
//  A. unreadable 2xx login body must not destroy the stored username and must not
//     cascade into username-less login requests;
//  B. an already-corrupted identity must self-heal (cleared + re-login prompt) instead
//     of looping 400s, and manual re-login must restore a full identity;
//  C. healthy identities keep auto-logging-in normally (regression guard).
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const serverPort = process.env.REPRO_SERVER_PORT ?? '3052';
const webPort = process.env.REPRO_WEB_PORT ?? '5202';
const base = `http://127.0.0.1:${webPort}`;
const dir = await mkdtemp(path.join(tmpdir(), 'cipai-identity-repro-'));
const children = [];
function run(args, env = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
  children.push(child);
  return child;
}
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Not ready: ${url}`);
}

let browser;
let failures = 0;
function report(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const loginBody = (req) => req.postData() ?? '';
const lacksUsername = (body) => { try { return typeof JSON.parse(body).username !== 'string'; } catch { return true; } };
const waitLogin = (page, timeout = 30000) => page.waitForRequest((r) => r.url().includes('/api/users/login'), { timeout }).catch(() => null);

try {
  const adminKey = crypto.randomBytes(32).toString('hex');
  run(['node_modules/tsx/dist/cli.mjs', 'apps/server/src/index.ts'], {
    PORT: serverPort, CLIENT_ORIGIN: base, USE_MEMORY_STORE: '1', ENABLE_DEBUG_TOOLS: '0',
    ENABLE_ANIME_DRAFT: '1', ENABLE_MATCH_ANALYSIS: '1', ENABLE_PREDICTIONS: '1', ENABLE_ANIME_COMMUNITY: '1',
    ANIME_POOL_STORE_FILE: path.join(dir, 'anime-pools.json'), ANIME_POOL_ADMIN_KEY: adminKey,
    USER_STORE_FILE: path.join(dir, 'users.json'), REVEAL_IMAGE_DIR: path.join(dir, 'images')
  });
  run(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', webPort, '--strictPort', 'apps/web'], { VITE_SERVER_URL: `http://127.0.0.1:${serverPort}` });
  await Promise.all([ready(`http://127.0.0.1:${serverPort}/health`), ready(base)]);
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch {}
  }
  if (!browser) throw new Error('No browser available');

  // ── Scenario A: 2xx with unreadable body must not poison the identity ──
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Simulate the incident: the first login responses (dev StrictMode fires twice)
    // arrive with 200 but an unreadable body; later requests pass through untouched.
    let windowStart = 0;
    await context.route('**/api/users/login', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('"username"')) {
        if (windowStart === 0) windowStart = Date.now();
        if (Date.now() - windowStart < 1500) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{"mode":"nam' });
          return;
        }
      }
      await route.continue();
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('acg-codenames-identity', JSON.stringify({ mode: 'named', username: 'Sparrow', nickname: 'Sparrow', avatarUrl: null }));
      localStorage.setItem('acg-codenames-recent-users', JSON.stringify(['Sparrow']));
    });
    const bodies = [];
    page.on('request', (req) => { if (req.url().includes('/api/users/login')) bodies.push(loginBody(req)); });
    await page.goto(`${base}/`);
    await waitLogin(page);
    await page.waitForTimeout(1500);
    let stored = null;
    try { stored = JSON.parse(await page.evaluate(() => localStorage.getItem('acg-codenames-identity'))); } catch {}
    report('A1 unreadable 2xx login body keeps a usable stored username',
      !!stored && stored.mode === 'named' && typeof stored.username === 'string' && stored.username.length > 0,
      `stored=${JSON.stringify(stored)}`);
    report('A2 no login request is sent without a username string',
      bodies.every((b) => !lacksUsername(b)), `bodies=${JSON.stringify(bodies)}`);
    await context.close();
  }

  // ── Scenario B: corrupted identity self-heals; manual re-login restores ──
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('acg-codenames-identity', '{"mode":"named"}');
      localStorage.setItem('acg-codenames-recent-users', '[null,"Sparrow"]');
    });
    const bodies = [];
    page.on('request', (req) => { if (req.url().includes('/api/users/login')) bodies.push(loginBody(req)); });
    await page.goto(`${base}/login`);
    await page.waitForSelector('.error-text', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    report('B1 corrupted identity does not trigger username-less login attempts',
      !bodies.some(lacksUsername), `bodies=${JSON.stringify(bodies)}`);
    const cleared = await page.evaluate(() => localStorage.getItem('acg-codenames-identity'));
    report('B2 corrupted identity is cleared from storage', cleared === null, `stored=${cleared}`);
    const errorText = (await page.locator('.error-text').first().textContent().catch(() => null)) ?? '';
    report('B3 user is prompted to log in again', /重新登录|失效/.test(errorText), `error="${errorText}"`);
    await page.getByPlaceholder('输入用户名').fill('Sparrow');
    await page.getByRole('button', { name: '进入结社', exact: true }).click();
    await page.waitForResponse((r) => r.url().includes('/api/users/login') && r.status() === 200, { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1200);
    let after = null;
    try { after = JSON.parse(await page.evaluate(() => localStorage.getItem('acg-codenames-identity'))); } catch {}
    report('B4 manual re-login restores a full named identity',
      !!after && after.mode === 'named' && after.username === 'Sparrow', `stored=${JSON.stringify(after)?.slice(0, 100)}`);
    const recent = await page.evaluate(() => localStorage.getItem('acg-codenames-recent-users'));
    report('B5 recent-users list no longer contains null', recent === '["Sparrow"]', `recent=${recent}`);
    await context.close();
  }

  // ── Scenario C: healthy identity still auto-logs-in (regression guard) ──
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('acg-codenames-identity', JSON.stringify({ mode: 'named', username: 'Sparrow', nickname: 'Sparrow', avatarUrl: null }));
      localStorage.setItem('acg-codenames-recent-users', JSON.stringify(['Sparrow']));
    });
    const bodies = [];
    page.on('request', (req) => { if (req.url().includes('/api/users/login')) bodies.push(loginBody(req)); });
    await page.goto(`${base}/`);
    await waitLogin(page);
    await page.waitForResponse((r) => r.url().includes('/api/users/login') && r.status() === 200, { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1000);
    report('C1 healthy identity auto-login posts the real username',
      bodies.some((b) => b.includes('"username":"Sparrow"')), `bodies=${JSON.stringify(bodies)}`);
    let stored = null;
    try { stored = JSON.parse(await page.evaluate(() => localStorage.getItem('acg-codenames-identity'))); } catch {}
    report('C2 session token persisted after auto-login',
      !!stored && stored.username === 'Sparrow' && typeof stored.userSessionToken === 'string',
      `stored=${JSON.stringify(stored)?.slice(0, 90)}`);
    await context.close();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const child of children) {
    if (child.exitCode === null) {
      if (process.platform === 'win32') {
        const kill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        await new Promise((r) => kill.on('exit', r));
      } else {
        child.kill();
      }
    }
  }
  await rm(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED (expected on the unfixed baseline)`);
process.exit(failures === 0 ? 0 : 1);
