// 联机大厅（docs/05）：建房（明确选择模式）、加房、座位与电脑难度、成员之间的网络情况和模式建议。
import type { AiLevel, RuleSet } from '../core/types.ts';
import { factionName, t, type TextKey } from '../i18n/index.ts';
import type { MemberInfo, NetMode, RoomInfo } from '../net/protocol.ts';
import type { NetSession, Online } from '../net/session.ts';
import { FACTION } from '../render/palette.ts';
import { h } from './dom.ts';

export interface LobbyHooks {
  onBack: () => void;
  onGame: (s: NetSession) => void;
}

export class LobbyScreen {
  readonly root: HTMLElement;
  private online: Online;
  private hooks: LobbyHooks;
  private panel = h('div', { class: 'panel lobby' });
  private mode: NetMode = 'server';
  private ruleset: RuleSet = 'remake';
  private code = '';
  private timer = 0;
  private lastKey = '';

  constructor(online: Online, hooks: LobbyHooks, joinCode = '') {
    this.online = online;
    this.hooks = hooks;
    this.code = joinCode;
    this.root = h('div', { class: 'lobby-screen' }, this.panel);
    online.onChange = () => this.render();
    online.onGameReady = (s) => this.hooks.onGame(s);
    // 已在等着加入的房间：连上后自动加入
    if (joinCode) {
      const tryJoin = () => {
        if (this.online.status === 'online') {
          if (!this.online.room) this.online.join(joinCode);
        } else window.setTimeout(tryJoin, 200);
      };
      tryJoin();
    }
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root);
    this.render();
    // 延迟数字每秒刷新
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  destroy(): void {
    clearInterval(this.timer);
    this.root.remove();
  }

  private render(): void {
    const o = this.online;
    const room = o.room;
    // 正在输入时不重建 DOM，免得输入框丢焦点
    const key = JSON.stringify([o.status, o.lastError, room, Math.round(o.srvRtt / 5), !!o.game, this.mode, this.ruleset]);
    if (key === this.lastKey) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && this.panel.contains(active)) return;
    this.lastKey = key;
    this.panel.replaceChildren(
      h('h2', {}, t('net.title')),
      this.statusLine(),
      room ? this.roomView(room) : this.entryView(),
    );
  }

  private statusLine(): HTMLElement {
    const o = this.online;
    const text =
      o.status === 'online' ? t('net.status.online', { ms: Math.round(o.srvRtt) })
      : o.status === 'version' ? t('net.status.version')
      : o.status === 'offline' ? t('net.status.offline')
      : t('net.status.connecting');
    return h('div', { class: `net-status ${o.status}` }, text);
  }

  // ---- 未进房间：建房 / 加入 ----

  private entryView(): HTMLElement {
    const o = this.online;
    const ok = o.status === 'online';
    const name = h('input', { class: 'text', maxLength: 16, placeholder: t('net.name.ph'), value: o.name });
    name.addEventListener('change', () => o.setName(name.value));
    const modeCard = (m: NetMode) =>
      h('button', { class: `mode-card${this.mode === m ? ' active' : ''}`, onClick: () => { this.mode = m; this.lastKey = ''; this.render(); } },
        h('div', { class: 'mode-name' }, t(`net.mode.${m}` as TextKey)),
        h('div', { class: 'mode-desc' }, t(`net.mode.${m}.desc` as TextKey)));
    const rules = h('select', { class: 'text', onChange: (e: Event) => (this.ruleset = (e.target as HTMLSelectElement).value as RuleSet) },
      h('option', { value: 'remake', selected: this.ruleset === 'remake' }, t('rules.remake')),
      h('option', { value: 'classic', selected: this.ruleset === 'classic' }, t('rules.classic')));
    const code = h('input', { class: 'text code', maxLength: 4, placeholder: t('net.code.ph'), value: this.code });
    code.addEventListener('input', () => (this.code = code.value.toUpperCase()));
    const err = o.lastError === 'noroom' ? t('net.err.noroom') : o.lastError === 'full' ? t('net.err.full') : '';
    return h('div', { class: 'lobby-entry' },
      h('label', { class: 'field' }, h('span', {}, t('net.name')), name),
      h('div', { class: 'lobby-box' },
        h('h3', {}, t('net.create')),
        h('div', { class: 'mode-cards' }, modeCard('server'), modeCard('host')),
        h('label', { class: 'field' }, h('span', {}, t('net.rules')), rules),
        h('button', { class: 'btn', disabled: !ok, onClick: () => { o.setName(name.value); o.create(this.mode, this.ruleset); } }, t('net.create.btn'))),
      h('div', { class: 'lobby-box' },
        h('h3', {}, t('net.join')),
        h('div', { class: 'row' }, code,
          h('button', { class: 'btn', disabled: !ok, onClick: () => { o.setName(name.value); if (code.value.trim()) o.join(code.value); } }, t('net.join.btn'))),
        err ? h('div', { class: 'net-err' }, err) : null),
      h('div', { class: 'lobby-actions' }, h('button', { class: 'btn ghost', onClick: () => this.hooks.onBack() }, t('menu.back'))));
  }

  // ---- 房间里 ----

  private roomView(r: RoomInfo): HTMLElement {
    const o = this.online;
    const me = r.members.find((m) => m.id === o.me);
    const owner = r.owner === o.me;
    const lobby = r.status === 'lobby';
    const invite = `${location.origin}${location.pathname}?room=${r.code}`;
    const send = (m: Parameters<Online['send']>[0]) => o.send(m);
    const aiSel = (c: number) => {
      const levels: AiLevel[] = r.ruleset === 'classic' ? ['classic'] : ['easy', 'normal', 'hard'];
      return h('select', {
        class: 'text small', disabled: !owner || !lobby,
        onChange: (e: Event) => { const ai = r.ai.slice(); ai[c] = (e.target as HTMLSelectElement).value as AiLevel; send({ t: 'config', ai }); },
      }, ...levels.map((lv) => h('option', { value: lv, selected: r.ai[c] === lv }, aiName(lv))));
    };
    const seats = [0, 1, 2, 3].map((c) => {
      const who = r.members.find((m) => m.seat === c);
      return h('div', { class: `seat${who ? ' taken' : ''}`, style: `--fc:${FACTION[c].ui}` },
        h('div', { class: 'seat-school' }, factionName(c)),
        who
          ? h('div', { class: 'seat-who' }, who.name, who.id === o.me ? h('span', { class: 'tag' }, t('hud.you')) : null, who.online ? null : h('span', { class: 'tag warn' }, t('net.offline')))
          : h('div', { class: 'seat-who cpu' }, t('net.cpu'), aiSel(c)),
        lobby && !who ? h('button', { class: 'btn small ghost', onClick: () => send({ t: 'seat', seat: c }) }, t('net.sit')) : null);
    });
    const modeBtn = (m: NetMode) =>
      h('button', { class: `btn small${r.mode === m ? ' active' : ' ghost'}`, disabled: !owner || !lobby, onClick: () => send({ t: 'config', mode: m }) }, t(`net.mode.${m}` as TextKey));
    const dropSel = h('select', {
      class: 'text small', disabled: !owner || !lobby,
      onChange: (e: Event) => send({ t: 'config', dropAi: (e.target as HTMLSelectElement).value as AiLevel }),
    }, ...(r.ruleset === 'classic' ? ['classic'] : ['easy', 'normal', 'hard']).map((lv) => h('option', { value: lv, selected: r.dropAi === lv }, aiName(lv as AiLevel))));
    const rulesSel = h('select', {
      class: 'text small', disabled: !owner || !lobby,
      onChange: (e: Event) => send({ t: 'config', ruleset: (e.target as HTMLSelectElement).value as RuleSet }),
    }, h('option', { value: 'remake', selected: r.ruleset === 'remake' }, t('rules.remake')), h('option', { value: 'classic', selected: r.ruleset === 'classic' }, t('rules.classic')));
    const hostSel = h('select', {
      class: 'text small', disabled: !owner || !lobby,
      onChange: (e: Event) => send({ t: 'config', host: (e.target as HTMLSelectElement).value }),
    }, ...r.members.map((m) => h('option', { value: m.id, selected: r.host === m.id }, m.name)));
    const humans = r.members.filter((m) => m.seat >= 0).length;
    const inGame = !!o.game;
    return h('div', { class: 'lobby-room' },
      h('div', { class: 'room-head' },
        h('div', { class: 'room-code' }, t('net.room'), h('b', {}, r.code)),
        h('button', { class: 'btn small ghost', onClick: () => void navigator.clipboard?.writeText(invite) }, t('net.copy'))),
      h('div', { class: 'lobby-box' },
        h('div', { class: 'row' }, h('span', { class: 'label' }, t('net.mode')), modeBtn('server'), modeBtn('host')),
        h('div', { class: 'mode-desc' }, t(`net.mode.${r.mode}.desc` as TextKey)),
        r.mode === 'host' ? h('div', { class: 'row' }, h('span', { class: 'label' }, t('net.host')), hostSel) : null,
        h('div', { class: 'advice' }, advice(r))),
      h('div', { class: 'seats' }, ...seats),
      h('div', { class: 'row' },
        h('span', { class: 'label' }, t('net.rules')), rulesSel,
        h('span', { class: 'label' }, t('net.dropAi')), dropSel,
        lobby && me && me.seat >= 0 ? h('button', { class: 'btn small ghost', onClick: () => send({ t: 'seat', seat: -1 }) }, t('net.spectate')) : null),
      this.netTable(r),
      h('div', { class: 'lobby-actions' },
        lobby && owner ? h('button', { class: 'btn', disabled: humans === 0 || o.status !== 'online', onClick: () => send({ t: 'start' }) }, t('net.start')) : null,
        lobby && !owner ? h('div', { class: 'menu-note' }, t('net.waitOwner')) : null,
        !lobby && !inGame ? h('button', { class: 'btn', onClick: () => o.rejoinGame() }, t('net.rejoin')) : null,
        !lobby && inGame ? h('div', { class: 'menu-note' }, t('net.entering')) : null,
        h('button', { class: 'btn ghost', onClick: () => o.leaveRoom() }, t('net.leave'))));
  }

  /** 每个成员到 LA 的延迟、到其他成员的直连情况 */
  private netTable(r: RoomInfo): HTMLElement {
    const rows = r.members.map((m) => {
      const cells = r.members.filter((x) => x.id !== m.id).map((x) => {
        const p = m.peers[x.id] ?? x.peers[m.id];
        const text = !p || p.via === 'trying' ? t('net.via.trying') : p.via === 'direct' ? `${t('net.via.direct')} ${p.rtt} ms` : t('net.via.relay');
        return h('span', { class: `peer ${p?.via ?? 'trying'}` }, `${x.name}：${text}`);
      });
      const tags = [r.owner === m.id ? t('net.owner') : '', r.mode === 'host' && r.host === m.id ? t('net.hostTag') : ''].filter(Boolean).join(' · ');
      return h('div', { class: 'net-row' },
        h('span', { class: 'net-name' }, m.name, tags ? h('span', { class: 'tag' }, tags) : null),
        h('span', { class: 'net-srv' }, m.online ? t('net.toLA', { ms: m.srv || '…' }) : t('net.offline')),
        h('span', { class: 'net-peers' }, ...cells));
    });
    return h('div', { class: 'net-table' }, h('h3', {}, t('net.table')), ...rows);
  }
}

function aiName(lv: AiLevel): string {
  return lv === 'classic' ? t('net.ai.classic') : t(`difficulty.${lv}` as TextKey);
}

/** 按测得的数据估算两种模式下"最慢那个人"的往返延迟，给出建议 */
function advice(r: RoomInfo): string {
  const players = r.members.filter((m) => m.online);
  if (players.length < 2) return t('net.advice.alone');
  const srv = Math.max(...players.map((m) => m.srv || 0));
  const host = r.members.find((m) => m.id === r.host);
  if (!host || !srv) return t('net.advice.measuring');
  let worst = 0;
  let direct = 0;
  let measured = true;
  for (const m of players) {
    if (m.id === host.id) continue;
    const p: MemberInfo['peers'][string] | undefined = m.peers[host.id] ?? host.peers[m.id];
    if (!p || p.via === 'trying') measured = false;
    else if (p.via === 'direct') {
      direct++;
      worst = Math.max(worst, p.rtt);
    } else worst = Math.max(worst, (m.srv || 0) + (host.srv || 0));
  }
  if (!measured) return t('net.advice.measuring');
  const better = worst + 40 < srv ? 'host' : 'server';
  return t('net.advice', { srv, host: worst, name: host.name, direct, n: players.length - 1, mode: t(`net.mode.${better}` as TextKey) });
}
