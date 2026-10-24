// 体验设置。规则与难度只对新开的对局生效，其余只影响操作和显示。
import { CLASSIC_RULES, remakeRules, type Rules, type RuleSet } from './core/types.ts';
import type { Lang } from './i18n/index.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Settings {
  lang: Lang;
  ruleset: RuleSet;
  difficulty: Difficulty;
  /** 战争迷雾（仅校园战争规则） */
  fog: boolean;
  colorblind: boolean;
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
  ruleset: 'remake',
  difficulty: 'normal',
  fog: true,
  colorblind: false,
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

/** 新对局使用的规则 */
export function newGameRules(): Rules {
  if (settings.ruleset === 'classic') return structuredClone(CLASSIC_RULES);
  return { ...remakeRules(settings.difficulty), fog: settings.fog };
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 忽略
  }
}
