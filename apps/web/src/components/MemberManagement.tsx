import type { PublicRoomState, Team } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';

export function canManageMembers(room:PublicRoomState) {
  return !!room.viewer?.isHost&&room.phase==='lobby'&&!room.countdown&&(!room.nextPlan||room.nextPlan.stage==='planning');
}
export function useMemberManagement(room:PublicRoomState) {
  const g=useGame();
  return (targetId:string,kind:'team'|'role'|'remove',extra:{team?:Team|null;role?:'spymaster'|'operative'}={})=>{
    if(!canManageMembers(room))return;
    void g.socket.timeout(5000).emitWithAck('manage_member',{roomId:room.id,targetId,kind,...extra}).then(result=>{
      if(!result.ok)g.setError(result.message??'成员管理失败');
    }).catch(()=>g.setError('管理请求未获确认，请检查最新成员状态后再操作。'));
  };
}
export function MemberManagement({room,targetId}:{room:PublicRoomState;targetId:string}) {
  const manage=useMemberManagement(room);
  if(!canManageMembers(room))return null;
  const player=room.players.find(p=>p.id===targetId),target=player??room.spectators.find(p=>p.id===targetId);
  if(!target)return null;
  return <details className="host-member-menu"><summary aria-label={`管理${target.nickname}`}>管理 ▾</summary><div>{player&&<><span className="hint-text">调整队伍</span>{(['red','blue',null] as const).map(t=><button key={t??'none'} disabled={player.team===t} onClick={()=>manage(targetId,'team',{team:t})}>{t==='red'?'移到红队':t==='blue'?'移到蓝队':'移到待分队'}</button>)}{player.team&&<button onClick={()=>manage(targetId,'role',{role:player.role==='spymaster'?'operative':'spymaster'})}>{player.role==='spymaster'?'设为队员':'任命队长'}</button>}</>}{targetId!==room.viewer?.participantId&&<button className="danger-button" onClick={()=>{if(window.confirm(`将「${target.nickname}」移出房间？原席位恢复凭证将失效。`))manage(targetId,'remove');}}>移出房间</button>}</div></details>;
}
