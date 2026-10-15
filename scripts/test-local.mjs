import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const data = await mkdtemp(path.join(tmpdir(), 'cipai-test-'));
const port = process.env.TEST_PORT ?? '3011';
const url = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: port, E2E_SERVER_URL: url, USE_MEMORY_STORE: '1', ENABLE_DEBUG_TOOLS: '0', ENABLE_ANIME_DRAFT: '1', USER_STORE_FILE: path.join(data, 'users.json'), REVEAL_IMAGE_DIR: path.join(data, 'images') };
const run = (args) => spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
const server = run(['node_modules/tsx/dist/cli.mjs', 'apps/server/src/index.ts']);
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Test server exited');
    try { if ((await fetch(`${url}/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  if (!ready) throw new Error('Test server did not become ready');
  for (const file of ['e2e.ts', 'reveal-guess.e2e.ts']) {
    const child = run(['--experimental-strip-types', `apps/server/test/${file}`]);
    const code = await new Promise(r => child.on('exit', r));
    if (code !== 0) throw new Error(`${file} failed (${code})`);
  }
} finally {
  if (process.platform === 'win32') {
    const kill = spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(r => kill.on('exit', r));
  } else { server.kill('SIGTERM'); }
  await rm(data, { recursive: true, force: true });
}

