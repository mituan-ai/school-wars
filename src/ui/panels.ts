// 标题画面和游戏中共用的面板：存读档、设置
import type { Game } from '../core/types.ts';
import { factionName, formatTime, getLang, setLang, t } from '../i18n/index.ts';
import { exportFile, importFile, readSlot, slotMeta, SLOTS, writeSlot, type SlotId } from '../save/storage.ts';
import { saveSettings, settings } from '../settings.ts';
import { h, modal } from './dom.ts';

function slotLabel(id: SlotId): string {
  return id === 'auto' ? t('save.auto') : t('save.slot', { n: id });
}

function metaText(id: SlotId): string {
  const m = slotMeta(id);
  if (!m) return t('save.empty');
  const who = m.userCol >= 0 && m.userCol < 4 ? factionName(m.userCol) : t('save.watch');
  const date = new Date(m.savedAt).toLocaleString(getLang() === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
  return `${t('save.meta', { name: who, time: formatTime(m.tick) })}　${date}`;
}

export function openSaveLoad(mode: 'save' | 'load', game: Game | null, onLoad: (g: Game) => void, onClose?: () => void): void {
  const list = h('div', { class: 'slot-list' });
  const status = h('div', { class: 'panel-status' });
  let close = () => {};
  const render = () => {
    list.replaceChildren();
    for (const id of SLOTS) {
      if (mode === 'save' && id === 'auto') continue;
      const has = slotMeta(id) !== null;
      const btn =
        mode === 'save'
          ? h('button', {
              class: 'btn small',
              onClick: () => {
                if (!game) return;
                try {
                  writeSlot(id, game);
                  status.textContent = t('save.saved');
                  render();
                } catch (e) {
                  status.textContent = t('save.failed', { err: String(e) });
                }
              },
            }, t('menu.save'))
          : h('button', {
              class: 'btn small',
              disabled: !has,
              onClick: () => {
                const g = readSlot(id);
                if (!g) {
                  status.textContent = t('save.loadfailed', { err: '?' });
                  return;
                }
                close();
                onLoad(g);
              },
            }, t('menu.load'));
      list.append(h('div', { class: 'slot' }, h('div', { class: 'slot-name' }, slotLabel(id)), h('div', { class: 'slot-meta' }, metaText(id)), btn));
    }
  };
  render();
  const extra =
    mode === 'save'
      ? h('button', { class: 'btn ghost', onClick: () => game && exportFile(game) }, t('menu.export'))
      : h('button', {
          class: 'btn ghost',
          onClick: () => {
            importFile()
              .then((g) => {
                close();
                onLoad(g);
              })
              .catch((e: unknown) => {
                status.textContent = t('save.loadfailed', { err: e instanceof Error ? e.message : String(e) });
              });
          },
        }, t('menu.import'));
  const content = h(
    'div',
    { class: 'panel' },
    h('h2', {}, mode === 'save' ? t('menu.save') : t('menu.load')),
    list,
    status,
    h('div', { class: 'panel-actions' }, extra, h('button', { class: 'btn', onClick: () => close() }, t('menu.back'))),
  );
  close = modal(content, onClose);
}

export function openSettings(onChange: () => void, onClose?: () => void): void {
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const input = h('input', { type: 'checkbox', checked: get() });
    input.addEventListener('change', () => {
      set(input.checked);
      saveSettings();
      onChange();
    });
    return h('label', { class: 'setting-row' }, h('span', {}, label), input);
  };
  const body = h('div', { class: 'settings' });
  let close = () => {};
  const render = () => {
    const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(settings.volume) });
    vol.addEventListener('input', () => {
      settings.volume = Number(vol.value);
      saveSettings();
    });
    const langBtn = (lang: 'zh' | 'en', label: string) =>
      h('button', {
        class: `btn small ${settings.lang === lang ? 'active' : 'ghost'}`,
        onClick: () => {
          settings.lang = lang;
          setLang(lang);
          saveSettings();
          onChange();
          render();
        },
      }, label);
    const ctrlBtn = (mode: 'modern' | 'classic') =>
      h('label', { class: 'radio-row' },
        h('input', {
          type: 'radio',
          name: 'controls',
          checked: settings.controls === mode,
          onChange: () => {
            settings.controls = mode;
            saveSettings();
            onChange();
          },
        }),
        h('span', {}, t(`settings.controls.${mode}`)));
    body.replaceChildren(
      h('h2', {}, t('settings.title')),
      h('div', { class: 'setting-row' }, h('span', {}, t('settings.lang')), h('div', { class: 'seg' }, langBtn('zh', '中文'), langBtn('en', 'English'))),
      h('div', { class: 'setting-block' }, h('div', { class: 'setting-label' }, t('settings.controls')), ctrlBtn('modern'), ctrlBtn('classic')),
      h('label', { class: 'setting-row' }, h('span', {}, t('settings.volume')), vol),
      toggle(t('settings.capture'), () => settings.showCapture, (v) => (settings.showCapture = v)),
      toggle(t('settings.spawn'), () => settings.showSpawn, (v) => (settings.showSpawn = v)),
      toggle(t('settings.edge'), () => settings.edgeScroll, (v) => (settings.edgeScroll = v)),
      h('div', { class: 'panel-actions' }, h('button', { class: 'btn', onClick: () => close() }, t('menu.back'))),
    );
  };
  render();
  close = modal(h('div', { class: 'panel' }, body), onClose);
}
