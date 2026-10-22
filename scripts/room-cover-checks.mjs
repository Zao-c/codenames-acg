import assert from 'node:assert/strict';
import {theme} from './browser-support.mjs';

export async function presetChecks({host,api,button,checks}){
  const catalog=await(await fetch(api+'/api/anime/catalog')).json();
  await button(host,'修改设置').click();
  const dialog=host.getByRole('dialog',{name:'本局设置',exact:true});
  await dialog.getByLabel('动画作品池',{exact:true}).waitFor();
  const values=await dialog.getByLabel('动画作品池',{exact:true}).locator('option').evaluateAll(items=>items.map(item=>item.value));
  for(const pool of catalog.pools)assert.equal(values.includes(pool.id),new Set(pool.workIds).size>=50,`preset visibility: ${pool.name}`);
  assert.ok(values.includes('current'),'existing room selection remains usable');assert.equal(values.includes('review-49'),false);assert.equal(values.includes('review-50'),true);
  await button(dialog,'取消').click();
  checks.push('system presets with fewer than 50 unique works hidden; current room selection preserved; no catalog deletion');
}

function luminance(rgb){return rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);}
export async function countdownChecks({host,states,button,until,shot,checks}){
  const plan=structuredClone(states[0].nextPlan);
  const planId=states[0].nextPlan.id;
  for(const width of [1440,390])for(const light of [true,false]){
    await host.setViewportSize({width,height:width===390?844:900});await theme(host,light);
    await button(host,'开始五秒倒计时').click();
    const cancel=button(host,'取消开局，返回房间');await cancel.waitFor();
    const colors=await cancel.evaluate(el=>{const s=getComputedStyle(el);return [s.color,s.backgroundColor].map(v=>v.match(/[\d.]+/g).map(Number));});
    const ls=colors.map(luminance).sort((a,b)=>b-a);assert.ok((ls[0]+.05)/(ls[1]+.05)>=4.5,'countdown cancel text contrast');
    await shot(host,`countdown-${width}-${light?'light':'dark'}`,'host');
    await cancel.click();await until(()=>!states[0].countdown,'cancel countdown');
    assert.equal(states[0].phase,'lobby');assert.equal(states[0].nextPlan.stage,'sealed');assert.equal(states[0].nextPlan.id,planId);assert.deepEqual(states[0].nextPlan,plan);
  }
  await host.setViewportSize({width:1440,height:900});await theme(host,false);
  checks.push('desktop/mobile/light/dark countdown cancel contrast >=4.5; cancel returns immediately and preserves sealed board');
}

export async function affiliationChecks({host,pages,checks}){
  const badges=host.locator('.anime-board-card:not(.is-revealed)>.captain-affiliation');
  const rows=await badges.evaluateAll(elements=>elements.map(el=>({text:el.textContent,color:getComputedStyle(el).backgroundColor,border:getComputedStyle(el.parentElement).borderStyle})));
  assert.ok(rows.length);assert.ok(rows.every(row=>['红队','蓝队','中立','刺客'].includes(row.text)));assert.equal(new Set(rows.map(row=>row.color)).size,4);assert.ok(rows.every(row=>row.border==='solid'));
  assert.equal(await pages[1].locator('.anime-board-card:not(.is-revealed)>.captain-affiliation').count(),0,'operative cannot see unopened affiliations');
  checks.push('captain sees four distinct solid color affiliations without redundant prefix; operative receives no unopened role label');
}

export async function returnChecks({host,pages,states,button,until,ack,checks,shot,size}){
  const old=states[0],id=old.id,replay=old.replayId,score=old.scores;
  assert.equal(await host.getByText('下一局计划',{exact:true}).count(),0);assert.equal(await button(host,'打开下一局设置').count(),0);
  assert.equal(await button(pages[1],'返回房间').count(),0,'non-host cannot reset room');
  const operative=pages[1];assert.ok(await operative.evaluate(()=>window.revealAnimations)>0,'real guesses start the flip animation');
  await operative.emulateMedia({reducedMotion:'reduce'});assert.equal(await operative.locator('.anime-board-card.is-revealed').first().evaluate(el=>getComputedStyle(el).animationName),'none');await operative.emulateMedia({reducedMotion:'no-preference'});
  await shot(host,`return-${size}-result`,'host');
  await button(host,'返回房间').click();await until(()=>states.every(s=>s?.phase==='lobby'),'all clients return with one click');
  await host.locator('.preparation-lobby').waitFor();assert.equal(await host.getByRole('dialog').count(),0);
  assert.equal(states[0].id,id);assert.deepEqual(states[0].scores,score);assert.equal(states[0].players.length,old.players.length);assert.ok(replay);
  const target=states[0].players.find(p=>p.team==='red'&&p.role!=='spymaster');assert.ok(target);
  for(const targetId of [target.id,old.players.find(p=>p.team==='red'&&p.role==='spymaster').id]){
    const r=await ack(host,'manage_member',{roomId:id,targetId,kind:'role',role:'spymaster'});assert.ok(r.ok,r.message);
    await until(()=>states[0].players.some(p=>p.id===targetId&&p.role==='spymaster'),'captain reassignment available immediately');
  }
  await shot(host,`return-${size}-lobby`,'host');
  checks.push(`${size}: host one-click return preserves room, players and score, all browser clients sync, captain reassignment immediately available; non-host reset not exposed`);
}
