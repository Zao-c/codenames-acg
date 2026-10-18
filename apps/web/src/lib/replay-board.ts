import type { GameReplay } from '@acg-codenames/shared';
export const roleLabel = (role: string) => ({red:'红队',blue:'蓝队',neutral:'中立',assassin:'刺客'}[role] ?? '未知');
export function replayCardId(replay: GameReplay, guess: GameReplay['rounds'][number]['guesses'][number]) {
  if (guess.cardId && replay.finalBoard.some(c=>c.id===guess.cardId)) return guess.cardId;
  const matches=replay.finalBoard.filter(c=>c.word===guess.word&&c.role===guess.role);
  return matches.length===1?matches[0].id:undefined;
}
export function cumulativeReplayBoard(replay: GameReplay, turn: number | null, guessCount?: number) {
  if(turn===null)return replay.finalBoard;
  const guesses=new Map(replay.rounds.filter(r=>r.index<=turn).flatMap(r=>(r.index===turn&&guessCount!==undefined?r.guesses.slice(0,guessCount):r.guesses).map(g=>[replayCardId(replay,g),{...g,team:r.team}] as const)));
  return replay.finalBoard.map(card=>{
    const guess=guesses.get(card.id);
    return {...card,revealed:!!guess,role:guess?.role,guessedByNickname:guess?.guessedByNickname,guessedByTeam:guess?.team};
  });
}
