import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {theme} from './browser-support.mjs';

async function fault(page,mode){await page.evaluate(async mode=>{
  const socket=(await import('/src/lib/socket.ts')).getSocket();
  if(!window.r10Emit){window.r10Writes=0;window.r10Emit=socket.emit.bind(socket);socket.emit=(event,...args)=>{
    if(event==='plan_action'&&args[0]?.kind==='configure'){
      window.r10Writes++;const callback=args.at(-1);
      if(typeof callback==='function'){
        if(window.r10Fault==='reject'){callback({ok:false,message:'测试拒绝：草稿未写入'});return socket;}
        args[args.length-1]=result=>{if(window.r10Fault==='drop')return;if(window.r10Fault==='hold'){window.r10Late=()=>callback(result);return;}if(window.r10Fault==='delay')setTimeout(()=>callback(result),600);else callback(result);};
      }
    }
    return window.r10Emit(event,...args);
  };}window.r10Fault=mode;
},mode);}

export async function settingsChecks(t){
 const {host,pages,states,baseline,checks,shot,button,until,matrix,ack}=t;
 const target=states[0].players[2].id;await ack(host,'manage_member',{roomId:states[0].id,targetId:target,kind:'team',team:'blue'});await until(()=>states[0].players.find(p=>p.id===target).team==='blue','uneven roster');await matrix(host,'lobby-unequal','host');await ack(host,'manage_member',{roomId:states[0].id,targetId:target,kind:'team',team:'red'});await until(()=>states[0].players.find(p=>p.id===target).team==='red','restore roster');
 await host.setViewportSize({width:1440,height:900});await theme(host,true);
 await button(host,'修改设置').click();let dialog=host.getByRole('dialog',{name:'本局设置',exact:true});
 await shot(host,'settings-1440-light','host');await dialog.getByLabel('棋盘',{exact:true}).selectOption('6x6');
 if(baseline){await button(dialog,'关闭本局设置').click();for(const width of [1440,390])for(const light of [true,false]){await host.setViewportSize({width,height:width===390?844:900});await theme(host,light);await button(host,'修改设置').click();await shot(host,`settings-${width}-${light?'light':'dark'}`,'host');await button(host.getByRole('dialog',{name:'本局设置',exact:true}),'关闭本局设置').click();}await host.setViewportSize({width:1440,height:900});return;}
 await fault(host,'none');let writes=await host.evaluate(()=>window.r10Writes);
 await button(dialog,'取消').click();const discard=host.getByRole('dialog',{name:'放弃本次修改？',exact:true});await button(discard,'继续编辑').click();assert.equal(await dialog.getByLabel('棋盘',{exact:true}).inputValue(),'6x6');await button(dialog,'关闭本局设置').click();await button(host.getByRole('dialog',{name:'放弃本次修改？'}),'放弃修改').click();
 await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});assert.equal(await dialog.getByLabel('棋盘',{exact:true}).inputValue(),'5x5');await button(dialog,'返回准备大厅').click();assert.equal(await host.evaluate(()=>window.r10Writes),writes);assert.notEqual(await host.evaluate(()=>document.body.style.overflow),'hidden','nested discard dialog releases the body scroll lock');
 checks.push('settings cancel/discard preserves confirmed values; unchanged return sends zero configuration requests');
 await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});await dialog.getByLabel('棋盘',{exact:true}).selectOption('6x6');await fault(host,'delay');const version=states[0].nextPlan.version;await button(dialog,'保存并返回准备大厅').click();assert.equal(await dialog.getByLabel('棋盘',{exact:true}).isDisabled(),true);assert.equal(await button(dialog,'关闭本局设置').isDisabled(),true);await dialog.waitFor({state:'hidden'});await until(()=>states.every(s=>s.nextPlan?.version===version+1&&s.nextPlan.settings.boardMode==='6x6'),'all clients confirmed saved settings');assert.equal(await host.evaluate(()=>window.r10Writes),writes+1);
 assert.equal(await button(pages[1],'修改设置').count(),0);assert.match(await pages[1].locator('.v2-mode-summary').innerText(),/6×6/);
 checks.push('delayed real ACK: controls locked, one request, all 8 players and 3 browser spectators receive authoritative summary');
 await fault(host,'reject');await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});await dialog.getByLabel('棋盘',{exact:true}).selectOption('5x5');await button(dialog,'保存并返回准备大厅').click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByLabel('棋盘',{exact:true}).inputValue(),'5x5');assert.equal(states[0].nextPlan.settings.boardMode,'6x6');await fault(host,'none');await button(dialog,'保存并返回准备大厅').click();await dialog.waitFor({state:'hidden'});
 checks.push('local ACK rejection injection: error preserves draft and confirmed server settings, explicit retry succeeds');
 await fault(host,'drop');await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});await dialog.getByLabel('棋盘',{exact:true}).selectOption('6x6');writes=await host.evaluate(()=>window.r10Writes);await button(dialog,'保存并返回准备大厅').click();await dialog.waitFor({state:'hidden',timeout:15000});assert.equal(await host.evaluate(()=>window.r10Writes),writes+1);assert.equal(states[0].nextPlan.settings.boardMode,'6x6');await fault(host,'none');
 checks.push('lost real ACK: timeout performs read-only sync, verifies saved version and closes without repeating write');
 await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});await dialog.getByLabel('动画作品池',{exact:true}).selectOption('custom');assert.ok(await dialog.locator('.anime-pool-list label').count()<=60);await dialog.locator('nav[aria-label="目录分页"]').getByRole('button',{name:'下一页',exact:true}).click();assert.ok(await dialog.locator('.anime-pool-list label').count()<=60);await button(dialog,'取消').click();await button(host.getByRole('dialog',{name:'放弃本次修改？'}),'放弃修改').click();
 for(const width of [1440,390])for(const light of [true,false]){await host.setViewportSize({width,height:width===390?844:900});await theme(host,light);await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});await shot(host,`settings-${width}-${light?'light':'dark'}`,'host');if(width===390){const box=await dialog.boundingBox();assert.equal(Math.round(box.height),844);assert.equal(Math.round(box.width),390);}await button(dialog,'返回准备大厅').click();}
 await host.setViewportSize({width:1024,height:900});await shot(host,'lobby-1024-light','host');const medium=await host.locator('.v2-next-step').boundingBox(),teams=await host.locator('.v2-players').boundingBox();assert.ok(medium.y>=teams.y+teams.height-1);await host.setViewportSize({width:1440,height:900});
 const boxes=await Promise.all(['.v2-mode','.v2-players','.v2-next-step'].map(s=>host.locator(s).boundingBox()));assert.ok(boxes.every(b=>b.height>=390));assert.ok(Math.max(...boxes.map(b=>b.y))-Math.min(...boxes.map(b=>b.y))<2);
 checks.push('settings full-screen on 390px, paged 6810-work picker, 1440px aligned tall columns and 1024px next-step row');
}

export async function tailChecks(t){
 const {host,pages,states,baseline,checks,shot,button,until,ack,matrix,raw}=t;
 if(states[0].phase!=='lobby'){await raw(host,'return_to_lobby',{roomId:states[0].id});await until(()=>states[0].phase==='lobby','four-person lobby');}
 const keep=new Set(['red','blue'].flatMap(team=>states[0].players.filter(p=>p.team===team).slice(0,2).map(p=>p.id)));
 for(const player of states[0].players.filter(p=>!keep.has(p.id))){const result=await ack(host,'manage_member',{roomId:states[0].id,targetId:player.id,kind:'remove'});assert.ok(result.ok,result.message);}
 await until(()=>states[0].players.length===4,'four seats');await matrix(host,'lobby-four','host');
 if(baseline)return;
 await host.setViewportSize({width:1440,height:900});await button(host,'修改设置').click();let dialog=host.getByRole('dialog',{name:'本局设置',exact:true});const old=states[0].id,version=states[0].nextPlan.version;
 await dialog.getByLabel('棋盘',{exact:true}).selectOption('5x5');await fault(host,'hold');await button(dialog,'保存并返回准备大厅').click();await until(()=>states[0].nextPlan.version===version+1,'held real ACK state');await until(async()=>await host.evaluate(()=>typeof window.r10Late==='function'),'held ACK');
 await host.evaluate(()=>{window.r10Held=window.r10Late;window.r10Fault='none';document.querySelector('.nav-brand').click();});await button(host,'＋ 创建房间').click();const create=host.getByRole('dialog',{name:'创建一间房间'});await button(create,'动画组牌').click();host.once('dialog',d=>d.accept());await button(create,'创建房间 →').click();await until(()=>states[0]?.id!==old&&states[0]?.nextPlan,'new room');
 await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});await dialog.getByLabel('棋盘',{exact:true}).selectOption('6x6');const writes=await host.evaluate(()=>window.r10Writes);await host.evaluate(()=>window.r10Held());await host.waitForTimeout(300);assert.equal(await dialog.isVisible(),true);assert.equal(await dialog.getByLabel('棋盘',{exact:true}).inputValue(),'6x6');assert.equal(states[0].nextPlan.settings.boardMode,'5x5');assert.equal(await host.evaluate(()=>window.r10Writes),writes);await shot(host,'settings-crossroom-safe','host');
 checks.push('4-seat final lobby and SPA room switch: delayed old real ACK cannot close/overwrite a new room settings draft');
}

export async function flipChecks(t){
 const {host,pages,states,baseline,checks,shot,button,until,ack,clue,matrix,out,size}=t,id=states[0].id;
 const guess=async card=>{const c=states[0].currentTeam==='red'?0:4,p=pages[c+1];await p.locator('.anime-board-card').nth(states[0].board.findIndex(x=>x.id===card.id)).click();const dialog=p.getByRole('dialog').last();await button(dialog,'猜牌').click();await button(dialog,'确认猜牌').click();await until(()=>states[0].board.find(x=>x.id===card.id).revealed,'real confirmed guess');};
 let c=states[0].currentTeam==='red'?0:4;await guess(states[c].board.find(x=>x.role===(states[0].currentTeam==='red'?'blue':'red')&&!x.revealed));
 c=states[0].currentTeam==='red'?0:4;await clue(c,'中立视觉检查'+size,2);await guess(states[c].board.find(x=>x.role==='neutral'&&!x.revealed));
 c=states[0].currentTeam==='red'?0:4;await clue(c,'刺客视觉检查'+size,2);await guess(states[c].board.find(x=>x.role==='assassin'&&!x.revealed));await until(()=>states[0].phase==='finished'&&states[0].replayId,'terminal assassin');
 const p=pages[1];await p.locator('.result-board>summary').click();for(const text of [false,true]){if(text)await button(p,'纯文字显示').click();await matrix(p,`${text?'text':'flips'}-${size}`,'red operative');if(text)await button(p,'封面显示').click();}
 if(!baseline){assert.equal(await p.locator('.anime-board-card.is-revealed .card-reveal-tint').count(),4);assert.equal(await host.locator('.anime-board-card:not(.is-revealed) .card-reveal-tint').count(),0);}
 const replay=await p.context().newPage();await replay.goto(process.env.PLAYTEST_BASE_URL+'/replay/'+states[0].replayId);await replay.locator('.replay-board-card').first().waitFor();await matrix(replay,`replay-${size}`,'public replay');
 if(!baseline)assert.equal(await replay.locator('.replay-board-card.is-revealed .card-reveal-tint').count(),4);
 for(const aspect of ['4:3','16:9'])for(const appearance of ['light','dark']){
   await button(replay,'导出棋盘 PNG').click();const dialog=replay.getByRole('dialog',{name:'导出公开棋盘'});await dialog.getByLabel('比例').selectOption(aspect);await dialog.getByLabel('背景').selectOption(appearance);await button(dialog,'生成 PNG').click();const image=dialog.getByAltText('公开终局棋盘 PNG');await image.waitFor();const bytes=await image.evaluate(async img=>Array.from(new Uint8Array(await(await fetch(img.src)).arrayBuffer())));await fs.writeFile(path.join(out,`export-${size}-${aspect.replace(':','x')}-${appearance}.png`),Buffer.from(bytes));await button(dialog,'关闭导出公开棋盘').click();
 }
 await button(replay,'逐回合回看').click();assert.equal(await replay.locator('.replay-post-affiliation').count(),0);await replay.close();
 if(!baseline){
   const gray=await sharp({create:{width:180,height:260,channels:3,background:{r:128,g:128,b:128}}}).png().toBuffer();
   const roles=['red','blue','neutral','assassin'];const cards=roles.map(role=>states[0].board.find(x=>x.revealed&&x.role===role));
   for(const card of cards)await p.route(card.anime.cover,r=>r.fulfill({contentType:'image/png',body:gray}));
   await p.setViewportSize({width:1440,height:900});await p.reload();await p.locator('.result-board>summary').click();await p.locator('.anime-board-card').first().waitFor();
   for(const light of [true,false]){await theme(p,light);for(const card of cards){const tile=p.locator('.anime-board-card').nth(states[0].board.findIndex(x=>x.id===card.id));await tile.scrollIntoViewIfNeeded();await until(async()=>await tile.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0),'fixture cover');const css=await tile.locator('.card-reveal-tint').evaluate(e=>({color:getComputedStyle(e).backgroundColor,opacity:getComputedStyle(e).opacity,rect:e.getBoundingClientRect().toJSON()}));assert.equal(css.opacity,'1');assert.ok(css.rect.width>0&&css.rect.height>0);const pixels=await sharp(await tile.screenshot()).raw().toBuffer({resolveWithObject:true});const {width,height,channels}=pixels.info;const sample=y=>Array.from(pixels.data.subarray((Math.floor(height*y)*width+width-5)*channels,(Math.floor(height*y)*width+width-5)*channels+3));assert.deepEqual(sample(.3),sample(.75),'single alpha at upper/lower cover sample');}}
   for(const card of cards)await p.unroute(card.anime.cover);
 }
 checks.push(`8-player ${size}: preview/draft/seal/countdown, actual red/blue/neutral/assassin guesses, cover/text/light/dark/desktop/mobile/replay/PNG; ${baseline?'baseline': 'uniform pixel tint and no tint on unopened affiliation'}`);
}
