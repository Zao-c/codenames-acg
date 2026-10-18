import { wordPackSummaries, type PlanAction, type PublicRoomState, type UpdateRoomSettingsPayload } from '@acg-codenames/shared';

export type Configuration = PlanAction | UpdateRoomSettingsPayload;
export class ConfigurationError extends Error {
  constructor(message:string, public uncertain=false) { super(message); }
}

/** Check an authoritative revision, rather than treating a bare ACK as saved. */
export function configurationMatches(base:PublicRoomState, room:PublicRoomState, payload:Configuration):boolean {
  if(room.id!==base.id||payload.roomId!==base.id)return false;
  const isPlan='kind' in payload;
  if(isPlan){
    const plan=room.nextPlan;
    if(!plan||plan.version!==(base.nextPlan?.version??1)+1||base.nextPlan&&plan.id!==base.nextPlan.id||plan.variant!==payload.variant)return false;
    if(payload.communityPoolId&&(plan.sourcePool?.id!==payload.communityPoolId||plan.sourcePool.revision!==payload.communityPoolRevision))return false;
    if(payload.poolName!==undefined&&plan.poolName!==payload.poolName.slice(0,64))return false;
    if(payload.poolIds&&plan.poolSummary?.source!==new Set(payload.poolIds).size)return false;
  }else if(room.updatedAt<=base.updatedAt)return false;
  const settings=isPlan?room.nextPlan!.settings:room.settings;
  for(const key of ['boardMode','scoringMode','timerMode','timerClueSeconds','timerGuessSeconds','flipMode'] as const){
    if(payload[key]!==undefined&&settings[key]!==payload[key])return false;
  }
  if(isPlan&&payload.variant==='anime')for(const key of ['animeRandomSwap','animeSeriesRotation'] as const)if(payload[key]!==undefined&&settings[key]!==payload[key])return false;
  const packName=isPlan?room.nextPlan?.wordPackName:room.wordPackSummary.name;
  if(payload.customWordPack&&packName!==payload.customWordPack.name)return false;
  if(payload.builtinWordPackId&&packName!==wordPackSummaries.find(p=>p.id===payload.builtinWordPackId)?.name)return false;
  return true;
}

export async function confirmConfiguration(options:{
  base:PublicRoomState;payload:Configuration;readRoom:()=>PublicRoomState;
  active:()=>boolean;emit:(reply:(result:{ok:boolean;message?:string})=>void)=>void;
  synchronize:()=>void;onChecking:()=>void;ackTimeout?:number;syncTimeout?:number;
}):Promise<PublicRoomState> {
  const {base,payload,readRoom,active}=options;
  if(!active()||readRoom().id!==base.id||payload.roomId!==base.id)throw new ConfigurationError('房间已切换，本次设置回执已忽略');
  let reply:{ok:boolean;message?:string}|undefined;
  options.emit(result=>{if(active())reply=result;});
  const until=Date.now()+(options.ackTimeout??8000);
  const valid=()=>{if(!active()||readRoom().id!==base.id)throw new ConfigurationError('房间已切换，本次设置回执已忽略');};
  while(Date.now()<until){
    valid();
    if(reply){
      if(!reply.ok)throw new ConfigurationError(reply.message??'服务器拒绝了本次设置');
      if(configurationMatches(base,readRoom(),payload))return readRoom();
    }
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  valid();options.onChecking();options.synchronize();
  const syncUntil=Date.now()+(options.syncTimeout??3000);
  while(Date.now()<syncUntil){
    valid();
    if(reply&&!reply.ok)throw new ConfigurationError(reply.message??'服务器拒绝了本次设置');
    if(configurationMatches(base,readRoom(),payload))return readRoom();
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  throw new ConfigurationError('尚未核对到本次保存的服务端版本。草稿已保留，请先核对最新状态。',true);
}
