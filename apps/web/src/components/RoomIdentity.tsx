import { TEAM_LABELS, type PublicRoomState } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';

/** Public identity and action guidance only. No draft ownership is inferred. */
export function RoomIdentity({room}:{room:PublicRoomState}) {
 const {connectionState,queueForNextRound,cancelQueueJoin}=useGame();
 const viewer=room.viewer;
 const spectator=viewer?.participantType==='spectator';
 const team=viewer?.team;
 const captain=room.phase==='lobby'&&team?room.nextPlan?.captains[team]===viewer?.participantId:viewer?.role==='spymaster';
 const stage=room.nextPlan?.stage;
 const identity=spectator?'旁观者':team?`${TEAM_LABELS[team]} · ${captain?'队长':'队员'}`:'待分队 · 玩家';
 const showQueue=spectator&&(room.phase==='playing'||stage==='draft');
 let title='好友入座，准备开局';
 let detail=spectator?'你可以聊天、观看公共信息，并按席位状态加入或候补。':'在「我的席位」选择队伍和身份，等待房主开始。';
 if(room.phase==='lobby'&&stage==='guide'){title='双方队长预览中';detail=captain?'浏览候选作品，确认就绪后双方同时开始组牌。':'你可以浏览候选作品，等待双方队长确认。';}
 if(room.phase==='lobby'&&stage==='draft'){title='双方同时组牌中';detail=captain?'领取、抢夺、撤回或更换作品；干扰牌需再次确认。':'实时观看匿名公共已选，浏览候选作品；可切换至聊天。';}
 if(room.phase==='lobby'&&stage==='sealed'){title='组牌已封存';detail='等待房主发起五秒开局。';}
 if(room.countdown){title='即将开始对局';detail='倒计时结束后自动进入棋盘。';}
 if(room.phase==='playing'){
   title=`${TEAM_LABELS[room.currentTeam]}行动中 · ${room.clue?'猜牌阶段':'等待线索'}`;
   detail=spectator?`只读观战 · 可聊天${viewer?.isQueuedForNextRound?' · 已候补下一局':''}`:viewer?.canSubmitClue?'轮到本队，请提交一个提示词和数字。':viewer?.canGuess?'轮到本队猜牌；点卡片预览，再确认猜牌。':team===room.currentTeam?'等待本队队友操作。':'本队等待，留意对方的线索与翻牌。';
 }
 if(room.phase==='finished'){title='本局已结束';detail='查看结算与复盘，或准备下一局。';}
 if(showQueue&&!viewer?.isQueuedForNextRound&&!viewer?.canQueueForNextRound)detail+=' 玩家席已满，等待空位后可排队。';
 if(connectionState!=='ready'){title='正在重新连接';detail='正在恢复最新局面，请等待连接确认。';}
 return <section className={`room-identity identity-${spectator?'spectator':team??'unassigned'}`} aria-label="身份与当前行动">
   <div className="room-identity-top"><span className="room-identity-pill">{identity}</span><span>第 {room.roundNumber} 局 · {(room.phase==='lobby'?room.nextPlan?.settings.boardMode:room.settings.boardMode)?.replace('x','×')}</span>{showQueue&&(viewer?.isQueuedForNextRound||viewer?.canQueueForNextRound)&&<button className="identity-queue-button" disabled={connectionState!=='ready'} onClick={viewer.isQueuedForNextRound?cancelQueueJoin:queueForNextRound}>{viewer.isQueuedForNextRound?'取消排队':'排队下一局'}</button>}</div>
   <strong>{title}</strong><p>{detail}</p>
 </section>;
}
