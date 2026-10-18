import {applyRoomDelta} from '@acg-codenames/shared';
/** Test traffic observers may see the same frame via polling and WebSocket; never double-apply. */
export function readRoomState(event,data,current){
  if(event==='room_state')return data;
  if(current?.id===data.roomId&&current.transportRevision>=data.revision)return current;
  const next=applyRoomDelta(current??null,data);
  if(!next)throw new Error('Observer missing room delta base '+JSON.stringify({roomId:data.roomId,expected:current?.transportRevision,base:data.baseRevision}));
  return next;
}
