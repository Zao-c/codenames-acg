import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// crypto.randomUUID and navigator.clipboard.writeText only exist in secure contexts
// (https / localhost). Production is served over plain HTTP, so bare browser calls
// crash at runtime: the chat requestId regression did exactly this and shipped past
// localhost-only browser suites. Keep every usage guarded.
const webSrc = path.resolve('apps/web/src');
const files: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
})(webSrc);
assert.ok(files.length > 10, `expected web sources under ${webSrc}`);

const violations: string[] = [];
for (const file of files) {
  const rel = path.relative(webSrc, file).split(path.sep).join('/');
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (/crypto\.randomUUID/.test(line) && !/typeof crypto !== "undefined"/.test(line)) violations.push(`${rel}:${index + 1} unguarded crypto.randomUUID`);
    if (/navigator\.clipboard\.writeText/.test(line) && rel !== 'lib/clipboard.ts') violations.push(`${rel}:${index + 1} raw navigator.clipboard.writeText without the lib/clipboard helper`);
  });
}
assert.deepEqual(violations, []);

const context = readFileSync(path.join(webSrc, 'context/GameContext.tsx'), 'utf8');
assert.match(context, /if \(typeof crypto !== "undefined" && crypto\.randomUUID\) return crypto\.randomUUID\(\);/);
assert.match(context, /requestId:genId\(\)/);
console.log('web client safety: crypto.randomUUID guarded for HTTP production, clipboard via helper, chat requestId through genId PASS');
