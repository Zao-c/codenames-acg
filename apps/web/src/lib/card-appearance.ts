import type { CardRole } from '@acg-codenames/shared';

/** Shared by the live/replay CSS layer and PNG exporter. One flat tint per card. */
const palette = {
  red: { light: 'rgba(158, 30, 54, 0.62)', dark: 'rgba(158, 30, 54, 0.65)', border: '#b83850', paper: '#f4cbd2' },
  blue: { light: 'rgba(25, 76, 153, 0.62)', dark: 'rgba(25, 76, 153, 0.65)', border: '#286bb3', paper: '#c9dff6' },
  neutral: { light: 'rgba(107, 76, 39, 0.62)', dark: 'rgba(107, 76, 39, 0.65)', border: '#8b7351', paper: '#e5d7bc' },
  assassin: { light: 'rgba(15, 20, 30, 0.78)', dark: 'rgba(12, 19, 31, 0.80)', border: '#343c4b', paper: '#343c4b' }
} satisfies Record<CardRole, {light:string;dark:string;border:string;paper:string}>;

export function cardAppearance(role: CardRole) { return palette[role]; }
