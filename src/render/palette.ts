// 重制版配色

export interface FactionColors {
  coat: string;
  light: string;
  dark: string;
  /** 小地图、地块、界面上的代表色 */
  ui: string;
  button: string;
}

export const FACTION: FactionColors[] = [
  { coat: '#33363f', light: '#5b6070', dark: '#17181d', ui: '#4a4f5e', button: '#e8c14a' },
  { coat: '#2f8f4a', light: '#58bf6f', dark: '#17562a', ui: '#3fb35e', button: '#f2d36b' },
  { coat: '#d9a520', light: '#f6cf55', dark: '#8a640c', ui: '#e8b62a', button: '#fff1b0' },
  { coat: '#8c3fc4', light: '#b874ea', dark: '#521c7e', ui: '#a157dc', button: '#f2d36b' },
];

export const NEUTRAL = '#b5b9b6';
export const SKIN = '#f3c9a0';
export const SKIN_DARK = '#d79e74';
export const HAIR = '#c3352a';
export const HAIR_LIGHT = '#ec6a4c';
export const HAIR_DARK = '#7d1c16';
export const OUTLINE = 'rgba(20,14,12,0.85)';
