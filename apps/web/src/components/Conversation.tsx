import type { ChatMessage, PublicRoomState } from '@acg-codenames/shared';

export function ChatMessages({messages,selfId}:{messages:ChatMessage[];selfId?:string}){
  return <>{messages.map((m,i)=>{
    const previous=messages[i-1];
    const consecutive=!!previous&&m.type==='chat'&&previous.type==='chat'&&!!m.playerId&&previous.playerId===m.playerId&&m.createdAt-previous.createdAt<120_000;
    return <article key={m.id} className={`conversation-message ${m.playerId===selfId?'is-self':''} ${consecutive?'consecutive':''}`}>
      {!consecutive&&<div className="conversation-meta"><span className="conversation-avatar" aria-hidden="true">{m.nickname?.slice(0,1)??'·'}</span><span>{m.nickname??'互动'}</span><time dateTime={new Date(m.createdAt).toISOString()}>{new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>}
      <p className="conversation-bubble">{m.text}</p>
    </article>;
  })}</>;
}

export function BattleEvents({messages,room}:{messages:ChatMessage[];room:PublicRoomState}){
  return <div className="battle-timeline">{messages.map(m=>{
    const event=m.event;
    const player=room.players.find(p=>m.text.startsWith(p.nickname));
    const team=event?.team??(m.text.startsWith('红队')?'red':m.text.startsWith('蓝队')?'blue':player?.team);
    const low=!event&&/加入|重连|离线|队伍|分队|旁观|创建|切换/.test(m.text);
    const record=event?.clueId?room.clueRecords?.find(c=>c.clueId===event.clueId):undefined;
    const round=record?(room.clueRecords?.indexOf(record)??0)+1:null;
    return <article key={m.id} className={`battle-event ${team?`team-${team}`:''} ${low?'low-priority':''}`}>
      <span className="battle-event-dot"/>
      <div><div className="battle-event-meta"><span>{team==='red'?'红队':team==='blue'?'蓝队':'房间'}{round?` · 第 ${round} 回合`:''}</span><time>{new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>
      {record&&<strong className="battle-clue">{record.word} ×{record.count}</strong>}
      <p>{m.text}</p></div>
    </article>;
  })}</div>;
}
