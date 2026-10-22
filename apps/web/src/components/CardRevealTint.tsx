import { memo, type CSSProperties } from 'react';
import type { CardRole } from '@acg-codenames/shared';
import { cardAppearance } from '../lib/card-appearance';

export const CardRevealTint = memo(function CardRevealTint({role}:{role:CardRole}) {
  const color=cardAppearance(role);
  return <span aria-hidden="true" className="card-reveal-tint" style={{'--card-tint-light':color.light,'--card-tint-dark':color.dark} as CSSProperties}/>;
});
