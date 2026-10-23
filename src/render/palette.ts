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
  { coat: '#2e5596', light: '#4f7cc6', dark: '#18305c', ui: '#3c6fd0', button: '#e8c14a' }, // 人族：钢蓝
  { coat: '#2a7a3e', light: '#45a85c', dark: '#154d24', ui: '#3fb35e', button: '#f2d36b' }, // 兽人
  { coat: '#c7861c', light: '#eaa94a', dark: '#7d4f0c', ui: '#e0a028', button: '#fff1b0' }, // 矮人：赤金
  { coat: '#8c3fc4', light: '#b874ea', dark: '#521c7e', ui: '#a157dc', button: '#e8e6f2' }, // 精灵：紫罗兰
];

export const NEUTRAL = '#b5b9b6';
export const SKIN = '#f3c9a0';
export const SKIN_DARK = '#d79e74';
export const HAIR = '#c3352a';
export const HAIR_LIGHT = '#ec6a4c';
export const HAIR_DARK = '#7d1c16';
export const OUTLINE = 'rgba(20,14,12,0.85)';
