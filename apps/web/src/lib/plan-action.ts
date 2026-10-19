import type {PlanAction,PublicRoomState} from '@acg-codenames/shared';

export function planActionEnvelope(room:PublicRoomState,action:Omit<PlanAction,'roomId'|'version'>):PlanAction{
  return {roomId:room.id,version:room.nextPlan?.version,draftProtocol:2,planId:room.nextPlan?.id,stageVersion:room.nextPlan?.stageVersion??0,
    requestId:globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,...action};
}
