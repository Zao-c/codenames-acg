import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const out=path.resolve('output/playwright/round10-room-cover'),docs=path.resolve('docs/round10-room-cover');
const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const before=await read('output/playwright/round10-feedback/after/report.json'),after=await read(path.join(out,'after/report.json')),tests=await read(path.join(out,'tests/results.json'));
assert.ok(after.passed&&tests.length===25&&tests.every(t=>t.passed));
await fs.mkdir(path.join(docs,'screens'),{recursive:true});
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const pairs=after.screens.filter(s=>before.screens.some(b=>b.file===s.file));
await fs.writeFile(path.join(out,'review.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>词牌结社 · 房间与封面修订</title><style>body{font:15px/1.65 system-ui;background:#f3f5f9;color:#17263d;margin:0}header,main{max-width:1800px;margin:auto;padding:20px}section{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure,aside{margin:0;background:white;border:1px solid #dce1e9;border-radius:12px;padding:12px}img{max-width:100%;height:auto}select,button{font:inherit;padding:8px;max-width:100%}@media(max-width:800px){section{grid-template-columns:1fr}}</style><header><h1>返回房间、封面恢复与阵营区分</h1><p>前版应用源码与生产 89b5f70 一致；本轮 ${esc(after.sha)}。8 玩家＋20 旁观，手机为 Chromium 模拟，牌面来自不同随机开局。</p><select id="scene">${after.screens.map((s,i)=>`<option value="${i}">${esc(s.file)}</option>`).join('')}</select><button id="prev">上一张</button><button id="next">下一张</button></header><main><aside>结算页直接返回原房间，棋盘在胜负下方；删除重复下一局卡片。深色统一蒙层与翻牌动画仅用于已翻牌；未翻阵营采用清楚的四色标签。新增画面仅展示修改后。<p><a href="tests/results.json">完整命令结果</a> · <a href="after/report.json">多人与截图原始记录</a></p></aside><section><figure><figcaption id="before-caption">修改前</figcaption><img id="before"></figure><figure><figcaption>修改后</figcaption><img id="after"></figure></section></main><script>const screens=${JSON.stringify(after.screens)},known=new Set(${JSON.stringify(before.screens.map(s=>s.file))});const scene=document.getElementById('scene');function show(){const s=screens[Number(scene.value)];document.getElementById('after').src='after/'+s.file;const b=document.getElementById('before');b.style.display=known.has(s.file)?'block':'none';if(known.has(s.file))b.src='../round10-feedback/after/'+s.file;document.getElementById('before-caption').textContent=known.has(s.file)?'修改前':'新增流程检查，没有对应的前版截图';}scene.onchange=show;document.getElementById('prev').onclick=()=>{scene.value=(Number(scene.value)+screens.length-1)%screens.length;show();};document.getElementById('next').onclick=()=>{scene.value=(Number(scene.value)+1)%screens.length;show();};show();</script>`);
await fs.writeFile(path.join(docs,'test-results.json'),JSON.stringify(tests,null,2)+'\n');
await fs.writeFile(path.join(docs,'browser-after.json'),JSON.stringify(after,null,2)+'\n');
const names=['captain-5x5-1440-light.png','captain-6x6-390-dark.png','flips-5x5-1440-light.png','flips-6x6-390-dark.png','text-6x6-390-light.png','feedback-settings-1440-light.png'];
const manifest=[],rows=[];
for(const file of names){
  assert.ok(pairs.some(s=>s.file===file),file);
  for(const [label,root,sha] of [['before','output/playwright/round10-feedback/after',before.sha],['after',path.join(out,'after'),after.sha]]){
    const data=await fs.readFile(path.join(root,file)),name=label+'-'+file;await fs.writeFile(path.join(docs,'screens',name),data);
    manifest.push({file:name,sourceSha:sha,sha256:crypto.createHash('sha256').update(data).digest('hex')});
  }
  rows.push(`| ${file} | ![修改前](screens/before-${file}) | ![修改后](screens/after-${file}) |`);
}
for(const file of ['countdown-390-light.png','return-6x6-result.png','return-6x6-lobby.png']){
  const data=await fs.readFile(path.join(out,'after',file));await fs.writeFile(path.join(docs,'screens',file),data);
  manifest.push({file,sourceSha:after.sha,sha256:crypto.createHash('sha256').update(data).digest('hex')});
}
await fs.writeFile(path.join(docs,'screens/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(docs,'screens.md'),'# 修改前后\n\n| 场景 | 修改前 | 修改后 |\n| --- | --- | --- |\n'+rows.join('\n')+'\n\n![倒计时手机浅色](screens/countdown-390-light.png)\n\n![结算返回房间](screens/return-6x6-result.png)\n\n![返回后的同一房间](screens/return-6x6-lobby.png)\n');
console.log(JSON.stringify({comparisons:pairs.length,screens:after.screens.length,committedImages:manifest.length,commands:tests.length}));
