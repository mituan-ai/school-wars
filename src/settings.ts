// 体验设置：只影响操作和显示，不改变规则
import type { Lang } from './i18n/index.ts';

export interface Settings {
  lang: Lang;
  controls: 'modern' | 'classic';
  volume: number;
  showCapture: boolean;
  showSpawn: boolean;
  edgeScroll: boolean;
  tipsSeen: boolean;
}

const KEY = 'schoolwars.settings';

const defaults: Settings = {
  lang: 'zh',
  controls: 'modern',
  volume: 0.6,
  showCapture: true,
  showSpawn: true,
  edgeScroll: false,
  tipsSeen: false,
};

export const settings: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // 隐私模式或存储被禁用时使用默认值
  }
  return { ...defaults };
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 忽略
  }
}
