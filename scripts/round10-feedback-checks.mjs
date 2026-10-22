import assert from 'node:assert/strict';
import {theme} from './browser-support.mjs';

export async function feedbackSettingsChecks(t){
 const {host,pages,states,checks,button,until,shot}=t;
 await host.setViewportSize({width:1440,height:900});await theme(host,true);
 const expected=['大厅','创建房间','文字题库','动画题库','图片图库','个人资料'];
 assert.deepEqual(await host.locator('.app-nav .nav-links>button').allTextContents(),expected);
 assert.equal(await host.locator('.nav-room-label').count(),0);
 const home=await pages[1].context().newPage();await home.goto(process.env.PLAYTEST_BASE_URL);await until(async()=>await home.locator('.app-nav .nav-links>button').count()===expected.length,'home features loaded');
 assert.deepEqual(await home.locator('.app-nav .nav-links>button').allTextContents(),expected);await home.close();
 assert.equal(await host.locator('.nav-preferences').innerText(),'偏好设置');assert.equal(await host.locator('.room-management-trigger').innerText(),'房间管理');
 await button(host,'房间管理').click();let dialog=host.getByRole('dialog',{name:'房间管理',exact:true});assert.equal(await dialog.getByRole('button',{name:'转让房主',exact:true}).count(),1);assert.equal(await host.getByText('转让社长',{exact:true}).count(),0);await shot(host,'feedback-room-management-1440-light','host');await button(dialog,'关闭房间管理').click();
 await button(host,'分队与队长管理').click();dialog=host.getByRole('dialog',{name:'分队与队长管理',exact:true});
 const original=states[0].nextPlan.captains.red,target=states[0].players.find(p=>p.team==='red'&&p.id!==original);
 await dialog.getByLabel('红队本局队长').selectOption(target.id);await until(()=>states[0].nextPlan.captains.red===target.id,'captain changed through modal');assert.equal(states[0].players.find(p=>p.id===original).role,'operative');
 await dialog.getByLabel('红队本局队长').selectOption(original);await until(()=>states[0].nextPlan.captains.red===original,'captain restored through modal');
 await shot(host,'feedback-team-management-1440-light','host');await host.setViewportSize({width:390,height:844});await shot(host,'feedback-team-management-390-light','host');await button(dialog,'完成并返回大厅').click();assert.notEqual(await host.evaluate(()=>document.body.style.overflow),'hidden');await host.setViewportSize({width:1440,height:900});
 const menu=host.locator('.host-member-menu>summary').first();assert.ok(!(await menu.innerText()).includes('▾'));assert.equal(await menu.evaluate(e=>getComputedStyle(e).listStyleType),'none');
 checks.push('same six global navigation entries on home and room; distinct preferences/room management; host terminology; one member menu indicator; real captain changes in desktop/mobile dialog');
 await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});
 await until(async()=>await dialog.locator('.settings-preview-covers img').count()===4,'four real current-pool covers');
 const left=await dialog.locator('.anime-config').boundingBox(),right=await dialog.locator('.settings-overview').boundingBox();assert.ok(right.x>=left.x+left.width-1);assert.ok(Math.abs(left.y-right.y)<2);
 const footer=await dialog.locator('.settings-actions').boundingBox(),modal=await dialog.boundingBox();assert.ok(footer.y+footer.height<=modal.y+modal.height+1,'save and cancel remain inside the dialog viewport');
 assert.deepEqual(await dialog.locator('.anime-config>section>h4').allTextContents(),['核心玩法','动画作品池','额外规则']);assert.equal(await dialog.locator('.settings-readonly').innerText(),'180 秒');
 const id=states[0].id,plan=states[0].nextPlan;
 const preview=await host.evaluate(async({id,plan})=>(await import('/src/lib/api.ts')).getPlanPoolPreview(id,plan.id,plan.version),{id,plan});assert.equal(preview.works.length,4);
 // Use the actual operative identity against the same protected projection.
 const forbidden=await pages[1].evaluate(async({id,plan,api})=>{const key=(await import('/src/lib/private-identity.ts')).privateIdentityKey();return(await fetch(`${api}/api/rooms/${id}/plan-pool?planId=${plan.id}&version=${plan.version}&preview=1`,{headers:{'x-private-key':key}})).status;},{id,plan,api:process.env.PLAYTEST_API_URL});assert.equal(forbidden,403);
 await button(dialog,'返回准备大厅').click();
 for(const width of [1440,390])for(const light of [true,false]){await host.setViewportSize({width,height:width===390?844:900});await theme(host,light);await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});await until(async()=>await dialog.locator('.settings-preview-covers img').count()===4,'overview ready');await shot(host,`feedback-settings-${width}-${light?'light':'dark'}`,'host');await button(dialog,'返回准备大厅').click();}
 await button(host,'修改设置').click();dialog=host.getByRole('dialog',{name:'本局设置',exact:true});
 const swap=plan.settings.animeRandomSwap;await dialog.getByRole('switch',{name:'随机互换',exact:true}).setChecked(!swap);assert.equal(states[0].nextPlan.settings.animeRandomSwap,swap,'rule draft does not mutate saved room');await button(dialog,'取消').click();await button(host.getByRole('dialog',{name:'放弃本次修改？'}),'放弃修改').click();await host.setViewportSize({width:1440,height:900});
 checks.push('reference-style two-column settings with three groups, four-cover bounded authorized preview, non-host denied, fixed 180s, light/dark desktop/mobile and cancelled rule draft');
}

export async function feedbackResultChecks({page,room,size,checks}){
 const board=page.locator('.result-board');await board.waitFor({state:'visible'});assert.equal(await board.locator('summary').count(),0);
 const hero=await page.locator('.result-hero-card').boundingBox(),b=await board.boundingBox(),honors=await page.locator('.result-two-columns').boundingBox();assert.ok(b.y>=hero.y+hero.height-1&&b.y<hero.y+hero.height+40);assert.ok(honors.y>=b.y+b.height-1);
 // A just-revealed card is still rotating and can temporarily enlarge
 // scrollHeight even when there is no scrollport. Check actual clipping rules.
 const scroll=await board.locator('.anime-board-scroll').evaluate(e=>{const s=getComputedStyle(e);return {overflow:s.overflowY,maxHeight:s.maxHeight};});
 assert.deepEqual(scroll,{overflow:'visible',maxHeight:'none'},'all final board rows are visible without an inner clipping scroll');
 const reviews=await page.locator('.result-reviews').innerText();for(const record of room.clueRecords.slice(-4))for(const guess of record.guesses){assert.ok(reviews.includes(guess.cardWord),'review includes actual flipped work');assert.ok(reviews.includes(guess.nickname),'review names actual guesser');}
 assert.ok(reviews.includes('刺客 · 对局结束'));assert.ok(reviews.includes('中立 · 回合结束'));checks.push(`${size} result board visible immediately after outcome and above honors/history; actual guessers, flipped cards and outcomes in highlights`);
}
