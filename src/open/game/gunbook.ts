import { AMMO_NAME, GUN_LIST, type GunClass } from './api';
import { SOURCE_TEXT, type Unlocks } from './unlocks';

const CLS: Array<[GunClass, string]> = [
  ['pistol', '手枪'],
  ['smg', '冲锋枪'],
  ['shotgun', '霰弹枪'],
  ['rifle', '步枪'],
  ['sniper', '狙击枪'],
  ['lmg', '机枪'],
];

/**
 * 武器图鉴的那张表：背包里看、据点的军械箱里借、生化模式开局挑、结算时用军功换，都是它。
 *   view 只看 · pick 已经解锁的那几行能点（行上带 data-gun）· buy 没解锁的后面有「换」的按钮（带 data-buy）
 * 点了以后做什么由用它的界面决定
 */
export function gunBook(u: Unlocks, mode: 'view' | 'pick' | 'buy', title: string, picked = ''): string {
  const rows: string[] = [];
  for (const [cls, name] of CLS) {
    for (const g of GUN_LIST) {
      if (g.cls !== cls) continue;
      const src = u.source(g.id);
      const can = mode === 'pick' && !!src;
      const btn = mode === 'buy' && !src ? `<button data-buy="${g.id}"${u.merits < u.price(g) ? ' disabled' : ''}>换 · ${u.price(g)} 军功</button>` : '';
      rows.push(
        `<div class="grow${src ? ' on' : ''}${can ? ' can' : ''}${picked === g.id ? ' sel' : ''}"${can ? ` data-gun="${g.id}"` : ''}><u>${name}</u><b>${g.name}</b><span>${AMMO_NAME[g.ammo]}</span><em>${src ? SOURCE_TEXT[src] : '还没解锁'}</em>${btn}</div>`,
      );
    }
  }
  return `<h3>${title}<span>已解锁 ${u.count} / ${GUN_LIST.length}${mode === 'buy' ? ` · 军功 ${u.merits}` : ''}</span></h3>
    <div class="glist">${rows.join('')}</div>
    <div class="gnote">怎么解锁：在生存世界里找到一把 · 守城模式里用勋章解锁 · 生化模式里用军功换。一边解锁，另外两边也认：守城模式直接拥有这个型号，生存世界据点的军械箱能借，生化模式开局能挑。<br>${u.where()}${u.canSync ? ' <button data-sync="1">同步到守城模式</button>' : ''}</div>`;
}

export const BOOK_CSS = `
  .g-modal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: #05070a99; z-index: 22; user-select: none; }
  .g-modal.open { display: flex; }
  .g-modal .box { width: min(760px, 94vw); max-height: 92vh; overflow-y: auto; padding: 18px 20px 14px; border: 1px solid #ffffff22; border-radius: 8px; background: #0e1216f2; box-shadow: 0 16px 60px #000c; color: #e8e0cc; font-size: 13px; }
  .g-modal h2 { margin: 0 0 6px; font-size: 22px; letter-spacing: .2em; color: #ffd36a; }
  .g-modal p { margin: 4px 0 10px; line-height: 1.7; color: #d8d0bc; }
  .g-modal .btns { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }
  .g-modal button, .g-inv .glist button { padding: 4px 12px; border: 1px solid #ffffff30; border-radius: 3px; background: #ffffff10; color: #f2ead8; font: 13px "Microsoft YaHei", sans-serif; cursor: pointer; }
  .g-modal button:hover:not(:disabled) { background: #ffd36a; color: #1a1408; }
  .g-modal button:disabled { opacity: .4; cursor: default; }
  .g-modal button.go { border-color: #ffd36a; color: #ffd36a; }
  .g-modal h3, .g-inv .book h3 { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 8px; font-size: 15px; letter-spacing: .2em; color: #ffd36a; }
  .g-modal h3 span, .g-inv .book h3 span { font-size: 12px; letter-spacing: 0; color: #ffffff90; }
  .glist { max-height: min(46vh, 400px); overflow-y: auto; padding-right: 4px; }
  .grow { display: flex; align-items: center; gap: 8px; padding: 5px 8px; margin-bottom: 3px; border-radius: 3px; background: #ffffff08; color: #ffffff60; }
  .grow u { width: 48px; text-decoration: none; font-size: 11px; }
  .grow b { width: 130px; font-weight: normal; }
  .grow span { width: 96px; font-size: 11px; }
  .grow em { flex: 1; font-style: normal; font-size: 12px; }
  .grow.on { color: #e8e0cc; }
  .grow.on b { color: #ffc46a; }
  .grow.on em { color: #9fd0ff; }
  .grow.can { cursor: pointer; }
  .grow.can:hover, .grow.sel { background: #ffd36a30; }
  .gnote { margin-top: 10px; font-size: 12px; line-height: 1.7; color: #ffffff80; }
  .gnote button { margin-left: 6px; padding: 1px 10px; border-color: #ffd36a; color: #ffd36a; font-size: 12px; }
`;
