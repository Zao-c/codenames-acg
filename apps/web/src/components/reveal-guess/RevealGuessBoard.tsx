import { memo, useEffect, useRef, useState } from "react";
import type { RevealCell as RevealCellType } from "@acg-codenames/shared";

const resolveImage = (url: string) => url.startsWith("/api/") ? `${import.meta.env.VITE_SERVER_URL || ""}${url}` : url;

export interface BoardCellData {
  cell: RevealCellType;
  imageUrl: string;
  canClick: boolean;
  onReveal: () => void;
  playerNickname?: string;
  isRecent?: boolean;
}

export const RevealGuessBoard = memo(function RevealGuessBoard({
  cells, className, showFullImage, isRoundEnd,
}: {
  cells: BoardCellData[];
  className: string;
  showFullImage?: boolean;
  isRoundEnd?: boolean;
}) {
  const prevRevealed = useRef<Set<string>>(new Set());
  const [justRevealed, setJustRevealed] = useState<Set<string>>(new Set());
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    return () => { timers.current.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    const now = new Set<string>();
    for (const c of cells) {
      if (c.cell.revealed) now.add(c.cell.id);
    }
    const fresh: string[] = [];
    for (const id of now) {
      if (!prevRevealed.current.has(id)) fresh.push(id);
    }
    prevRevealed.current = now;

    if (fresh.length > 0) {
      setJustRevealed(prev => {
        const next = new Set(prev);
        for (const id of fresh) next.add(id);
        return next;
      });
      for (const id of fresh) {
        const t = setTimeout(() => {
          setJustRevealed(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          timers.current.delete(t);
        }, 600);
        timers.current.add(t);
      }
    }
  }, [cells]);

  return (
    <div
      role="grid"
      aria-label="揭幕猜番棋盘"
      className={`rg-board-grid ${className}`}
      style={
        (showFullImage || isRoundEnd) && cells.length > 0
          ? {
              backgroundImage: `url(${resolveImage(cells[0].imageUrl)})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      {cells.map(({ cell, imageUrl, canClick, onReveal, playerNickname, isRecent }) => (
        <button
          key={cell.id}
          className={`rg-cell${canClick ? " rg-cell-clickable" : ""}${cell.revealed ? " rg-cell-revealed" : ""}${isRecent && cell.revealed ? " rg-cell-recent" : ""}${justRevealed.has(cell.id) ? " rg-cell--just-revealed" : ""}`}
          aria-label={`格子 ${cell.row + 1}-${cell.col + 1}${cell.revealed ? " 已翻开" : " 未翻开"}`}
          onClick={onReveal}
          disabled={!canClick}
          style={
            cell.revealed && !showFullImage && !isRoundEnd
              ? ({
                  ["--rg-img" as string]: `url(${resolveImage(imageUrl)})`,
                  ["--rg-col" as string]: String(cell.col),
                  ["--rg-row" as string]: String(cell.row),
                  backgroundColor: "transparent",
                } as React.CSSProperties)
              : undefined
          }
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && canClick) {
              e.preventDefault();
              onReveal();
            }
          }}
        >
          {cell.revealed && !showFullImage && !isRoundEnd ? (
            <span className="rg-cell-image" />
          ) : null}
          {cell.revealed && playerNickname ? (
            <span className="rg-cell-tag">{playerNickname}</span>
          ) : null}
          {!cell.revealed && canClick ? (
            <span className="rg-cell-qmark">✦</span>
          ) : null}
        </button>
      ))}
    </div>
  );
});
