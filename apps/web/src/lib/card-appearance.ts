import type { CardRole } from '@acg-codenames/shared';

/** Shared by the live/replay CSS layer and PNG exporter. One flat tint per card. */
const palette = {
  red: { light: 'rgba(193, 64, 85, 0.34)', dark: 'rgba(224, 91, 114, 0.38)', border: '#b83850', paper: '#f4cbd2' },
  blue: { light: 'rgba(61, 123, 205, 0.34)', dark: 'rgba(85, 148, 231, 0.38)', border: '#286bb3', paper: '#c9dff6' },
  neutral: { light: 'rgba(172, 137, 87, 0.35)', dark: 'rgba(190, 157, 106, 0.37)', border: '#8b7351', paper: '#e5d7bc' },
  assassin: { light: 'rgba(31, 38, 50, 0.46)', dark: 'rgba(12, 19, 31, 0.50)', border: '#343c4b', paper: '#343c4b' }
} satisfies Record<CardRole, {light:string;dark:string;border:string;paper:string}>;

export function cardAppearance(role: CardRole) { return palette[role]; }
