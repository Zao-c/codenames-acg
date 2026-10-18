import assert from 'node:assert/strict';

export async function managedClick(page,name){
  const tools=page.locator('.v2-more-management');
  if(await tools.count()&&!await tools.evaluate(element=>element.open))await tools.locator('summary').first().click();
  await page.getByRole('button',{name,exact:true}).click();
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
