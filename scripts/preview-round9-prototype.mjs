import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const input=process.env.ROUND9_PROTOTYPE_INPUT??path.resolve('../../output/playwright/round9/input');
const file=(await fs.readdir(input)).find(name=>name.endsWith('.html'));
if(!file)throw new Error('Provide the extracted user ZIP directory with ROUND9_PROTOTYPE_INPUT');
const out=path.resolve('output/playwright/round9/prototype');await fs.mkdir(out,{recursive:true});
let browser;for(const channel of ['chromium','msedge','chrome',undefined])try{browser=await chromium.launch({channel,headless:true});break;}catch{}
if(!browser)throw new Error('No Chromium');
try{
const page=await browser.newPage();await page.route('https://**',route=>route.abort());await page.route('http://**',route=>route.abort());
await page.goto(pathToFileURL(path.join(input,file)).href);
async function capture(name){for(const width of [1440,1920,390]){await page.setViewportSize({width,height:width===390?844:width===1920?1080:900});for(const dark of [false,true]){const toggle=page.getByRole('button',{name:/深色|浅色/});if((await toggle.innerText()).includes('浅色')!==dark)await toggle.click();await page.screenshot({path:path.join(out,`${name}-${width}-${dark?'dark':'light'}.png`),fullPage:true});}}}
for(const [label,name] of [['正式对局','game'],['房主分队','teams'],['组牌流程','draft']]){await page.getByRole('button',{name:label,exact:true}).click();await capture(name);}
await page.locator('#draftNextBtn').click();await page.locator('[data-step="interference"].active').waitFor();await capture('interference');
await fs.writeFile(path.join(out,'README.txt'),'仅用户上传 HTML 的交互原型截图；模拟数据，无服务端连接，不代表新规则已启用，不用于生产素材或公开发布。\n');
console.log('Prototype review: game, teams, draft and proposed interference; 24 local-only screenshots');
}finally{await browser.close();}
