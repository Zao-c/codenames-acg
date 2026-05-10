import type { ChatReaction } from "@acg-codenames/shared";

export function AvatarBadge({
  avatarUrl,
  fallback,
  size,
  effect
}: {
  avatarUrl: string | null;
  fallback: string;
  size: "small" | "medium" | "large";
  effect?: ChatReaction;
}) {
  const className = ["avatar-badge", size];
  if (effect) className.push(`avatar-effect-${effect}`);
  const fallbackText = fallback.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div className={className.join(" ")}>
      {avatarUrl ? <img src={avatarUrl} alt={fallback} /> : <span>{fallbackText}</span>}
    </div>
  );
}
