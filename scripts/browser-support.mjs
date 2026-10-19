import assert from 'node:assert/strict';

export async function openMemberTools(page){
  const dialog=page.getByRole('dialog',{name:'分队与队长管理',exact:true});
  if(await dialog.isVisible())return;
  const tools=page.locator('.v2-more-management');
  if(await tools.count()){
    if(await tools.evaluate(element=>element.tagName==='BUTTON'))await tools.click();
    else if(!await tools.evaluate(element=>element.open))await tools.locator('summary').first().click();
  }
}
export async function managedClick(page,name){
  await openMemberTools(page);
  await page.getByRole('button',{name,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'分队与队长管理',exact:true});
  if(await dialog.isVisible())await dialog.getByRole('button',{name:'完成并返回大厅',exact:true}).click();
}

export async function showResultBoard(page){
  const summary=page.locator('.result-board>summary');
  if(await summary.count()&&!await summary.evaluate(element=>element.parentElement.open))await summary.click();
  await page.locator('.result-board').waitFor({state:'visible'});
}

export async function theme(page,light){
  if(await page.evaluate(()=>document.documentElement.classList.contains('light'))===light)return;
  const graph=page.getByRole('dialog',{name:'关联板与思路',exact:true});
  const restore=await graph.isVisible();
  if(restore)await page.getByRole('button',{name:'关闭关联板与思路',exact:true}).click();
  await page.getByRole('button',{name:'打开快捷设置',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'设置',exact:true});
  await settings.getByRole('button',{name:light?'切换亮色主题':'切换暗色主题',exact:true}).click();
  await settings.getByRole('button',{name:'关闭设置',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('light')),light);
  if(restore)await page.getByRole('button',{name:'关联板与思路',exact:true}).click();
}
