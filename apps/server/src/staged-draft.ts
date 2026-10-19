import {type AnimeDraftRules,type AnimeWork,type NextPlan,type PlanAction,type Team} from '@acg-codenames/shared';
import {sealDraft} from './anime-draft.js';

const teams=['red','blue'] as const;
export function staged(plan:NextPlan){return plan.variant==='anime'&&plan.settings.animeDraft?.version===2;}
export function validateDraftRules(value:unknown):AnimeDraftRules{
  if(!value||typeof value!=='object')throw new Error('组牌时间设置无效');
  const v=value as AnimeDraftRules;
  if(v.version!==2||![180,240,300].includes(v.selectionSeconds)||![30,60,null].includes(v.interferenceSeconds))throw new Error('选牌时间须为 3／4／5 分钟，干扰时间须为 30／60 秒或不限时');
  return {version:2,selectionSeconds:v.selectionSeconds,interferenceSeconds:v.interferenceSeconds};
}
export function hasManual(plan:NextPlan,team:Team){return Object.values(plan.claims).some(c=>c.team===team&&c.kind==='manual');}
export function interferenceChoices(plan:NextPlan,history:Record<string,number>,replacing?:Team):AnimeWork[]{
  const byId=new Map([...plan.pool,...plan.candidates].map(w=>[w.id,w]));
  const used=new Set(Object.entries(plan.claims).filter(([,c])=>!(c.kind==='interference'&&c.from===replacing)).map(([id])=>byId.get(Number(id))?.seriesId));
  return plan.pool.filter(w=>!used.has(w.seriesId)&&(plan.settings.animeSeriesRotation!==true||history[w.seriesId]===undefined));
}
function refreshInterferenceWorks(plan:NextPlan){
  const ids=new Set(Object.entries(plan.claims).filter(([,c])=>c.kind==='interference').map(([id])=>Number(id)));
  plan.interferenceWorks=plan.pool.filter(w=>ids.has(w.id));
}
function sealWhenReady(plan:NextPlan,history:Record<string,number>,random:()=>number){
  if(!teams.every(t=>plan.done[t]&&hasManual(plan,t)))return;
  // sealDraft validates and commits on the caller's cloned room under its lock.
  sealDraft(plan,history,random);plan.stageVersion=(plan.stageVersion??0)+1;
}
export function advanceStagedDraft(plan:NextPlan,history:Record<string,number>,time:number,random=Math.random):boolean{
  if(!staged(plan))return false;
  let changed=false;
  if(plan.stage==='draft'&&((plan.endsAt!==undefined&&time>=plan.endsAt)||(plan.done.red&&plan.done.blue))){
    plan.stage='interference';plan.stageVersion=(plan.stageVersion??0)+1;plan.done={red:false,blue:false};plan.interferenceClosed=false;
    const seconds=plan.settings.animeDraft!.interferenceSeconds;
    plan.endsAt=seconds===null?undefined:time+seconds*1000;changed=true;
  }
  if(plan.stage==='interference'&&!plan.interferenceClosed&&plan.endsAt!==undefined&&time>=plan.endsAt){
    for(const from of teams){
      if(!Object.values(plan.claims).some(c=>c.kind==='interference'&&c.from===from)){
        const choices=interferenceChoices(plan,history);const work=choices[Math.floor(random()*choices.length)];
        if(!work)throw new Error('没有合法干扰作品，请取消准备并更换作品池');
        plan.claims[work.id]={team:from==='red'?'blue':'red',kind:'interference',from,protectedUntil:0};
      }
      plan.done[from]=true;
    }
    refreshInterferenceWorks(plan);plan.interferenceClosed=true;plan.endsAt=undefined;
    plan.stageVersion=(plan.stageVersion??0)+1;changed=true;
  }
  if(plan.stage==='interference'&&teams.every(t=>plan.done[t]&&hasManual(plan,t))){sealWhenReady(plan,history,random);changed=true;}
  return changed;
}
export function editStagedInterference(plan:NextPlan,team:Team,action:PlanAction,time:number,history:Record<string,number>,random=Math.random){
  if(plan.stage!=='interference')throw new Error('当前不是独立干扰阶段');
  if(action.kind==='take'){
    if(hasManual(plan,team))throw new Error('普通选牌已锁定，仅零手选队伍可补选一张');
    const work=plan.candidates.find(w=>w.id===action.workId);
    if(!work||plan.claims[work.id]||!interferenceChoices(plan,history).some(w=>w.seriesId===work.seriesId))throw new Error('请选择一张未上场的候选普通牌');
    plan.claims[work.id]={team,kind:'manual',protectedUntil:0};
  }else if(action.kind==='unready'){
    if(plan.interferenceClosed)throw new Error('干扰时间已结束，系统已准备');
    plan.done[team]=false;
  }else if(action.kind==='interfere'){
    if(plan.interferenceClosed||plan.done[team])throw new Error('请先取消准备；已截止的干扰不可修改');
    const work=interferenceChoices(plan,history,team).find(w=>w.id===action.workId);
    if(!work)throw new Error('干扰作品已被选中、系列重复或不在本局可用作品池');
    for(const [id,claim] of Object.entries(plan.claims))if(claim.kind==='interference'&&claim.from===team)delete plan.claims[Number(id)];
    plan.claims[work.id]={team:team==='red'?'blue':'red',kind:'interference',from:team,protectedUntil:0};refreshInterferenceWorks(plan);
  }else if(action.kind==='confirm-interference'){
    if(!hasManual(plan,team))throw new Error('请先补选至少一张普通手选牌，互换不能使用干扰或系统补位牌');
    if(!Object.values(plan.claims).some(c=>c.kind==='interference'&&c.from===team))throw new Error('请先选择一张给对方的干扰牌');
    plan.done[team]=true;
  }else throw new Error('普通选牌已结束，当前只能投放干扰并准备');
  sealWhenReady(plan,history,random);
}
