<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { App } from '../../app/boot';
import { GUNS, GUN_BY_ID } from '../../game/data/guns';
import { WEAPON_ORDER, type WeaponKind } from '../../game/data/weapons';
import { defaultGunFit, handFits, type GunFit, type HandFit } from '../../render/weapons/hand-fit';
import { ui } from '../store';

/**
 * 手部调节面板（开发用，F9 开关）：对着 TACZ 枪调程序手臂的位置、旋转、手指弯曲、肩膀位置。
 * 改动实时生效、自动存在本机（localStorage）；「复制本枪 / 复制全部」导出的 JSON 发给开发者，
 * 烘焙进 src/render/weapons/hand-fit.json 之后所有人都用这套参数。
 */
const props = defineProps<{ app: App }>();
const vm = props.app.view.viewmodel;
const game = props.app.game;

const open = ref(false);
const side = ref<'R' | 'L'>('L');
const gunId = ref('');
const fit = reactive<GunFit>(defaultGunFit());
const freeze = ref(false);
const ghost = ref(true);
const ads = ref(false);
const copied = ref('');
const tunedTick = ref(0);

interface Row {
  k: keyof HandFit;
  name: string;
  min: number;
  max: number;
  step: number;
}
const GROUPS: Array<{ title: string; rows: Row[] }> = [
  {
    title: '手的位置（像素：右 / 上 / 前）',
    rows: [
      { k: 'x', name: '左右', min: -12, max: 12, step: 0.1 },
      { k: 'y', name: '上下', min: -12, max: 12, step: 0.1 },
      { k: 'z', name: '前后', min: -16, max: 16, step: 0.1 },
    ],
  },
  {
    title: '手的旋转（度）',
    rows: [
      { k: 'rx', name: '俯仰', min: -180, max: 180, step: 1 },
      { k: 'ry', name: '偏转', min: -180, max: 180, step: 1 },
      { k: 'rz', name: '翻滚', min: -180, max: 180, step: 1 },
    ],
  },
  {
    title: '手指',
    rows: [
      { k: 'curl', name: '弯曲', min: 0, max: 1.8, step: 0.02 },
      { k: 'thumb', name: '拇指张开', min: -60, max: 90, step: 1 },
    ],
  },
  {
    title: '前臂方向（肩膀位置，像素×4）',
    rows: [
      { k: 'sx', name: '肩·左右', min: -8, max: 8, step: 0.1 },
      { k: 'sy', name: '肩·上下', min: -8, max: 8, step: 0.1 },
      { k: 'sz', name: '肩·前后', min: -8, max: 8, step: 0.1 },
      { k: 'elbow', name: '肘外撇', min: -3, max: 3, step: 0.05 },
    ],
  },
];

/** 枪包里有模型的型号，按枪类排 */
const guns = computed(() => {
  void tunedTick.value;
  return GUNS.slice()
    .sort((a, b) => WEAPON_ORDER.indexOf(a.cls) - WEAPON_ORDER.indexOf(b.cls))
    .map((g) => ({ id: g.id, name: g.name, cls: g.cls, tuned: handFits.isTuned(g.id) }));
});

const hand = computed(() => (side.value === 'R' ? fit.R : fit.L));

/** 换枪只在训练场里开放：正式对局里随手拿全部枪等于作弊（排行、结算都会算进去） */
const canSwitch = computed(() => ui.screen === 'training');
const idx = computed(() => guns.value.findIndex((g) => g.id === gunId.value));
const tunedCount = computed(() => guns.value.filter((g) => g.tuned).length);
/** 切过去的枪模型还没加载好（这时画面上还是程序枪模，调了也看不到） */
const loading = ref(false);

/** 上一把 / 下一把：按列表顺序挨个调 */
function step(d: number): void {
  const list = guns.value;
  if (!list.length || !canSwitch.value) return;
  const i = ((idx.value < 0 ? 0 : idx.value) + d + list.length) % list.length;
  equip((list[i] as { id: string }).id);
}

function load(id: string): void {
  gunId.value = id;
  const f = handFits.get(id);
  fit.scale = f.scale;
  Object.assign(fit.R, f.R);
  Object.assign(fit.L, f.L);
}

/** 把手里的枪换成某个型号（直接改局内状态：调试用） */
function equip(id: string): void {
  const g = GUN_BY_ID[id];
  if (!g || !canSwitch.value) return;
  const k = g.cls as WeaponKind;
  const slot = game.loadout[k];
  slot.owned = true;
  slot.carried = true;
  game.config.guns[k] = id;
  game.player.weapon = k;
  game.player.tier = slot.tier;
  vm.ensureTacz(id);
  pending = id;
  load(id);
}
/** 刚切过去、模型还在加载的型号：这段时间别被「游戏里手上那把」切回去 */
let pending = '';

/** 和已经存的一样就不存（只是切过去看一眼的枪不算「调过」） */
function save(): void {
  if (!gunId.value) return;
  if (JSON.stringify(handFits.get(gunId.value)) === JSON.stringify(fit)) return;
  handFits.set(gunId.value, fit);
  tunedTick.value++;
}

function resetHand(): void {
  const d = handFits.bakedOf(gunId.value);
  Object.assign(side.value === 'R' ? fit.R : fit.L, side.value === 'R' ? d.R : d.L);
  save();
}

function resetGun(): void {
  handFits.reset(gunId.value);
  load(gunId.value);
  tunedTick.value++;
}

/** 把另一只手的参数镜像过来（左右翻转 x / 偏转 / 翻滚 / 肩左右 / 肘） */
function mirror(): void {
  const from = side.value === 'R' ? fit.L : fit.R;
  const to = side.value === 'R' ? fit.R : fit.L;
  Object.assign(to, { ...from, x: -from.x, ry: -from.ry, rz: -from.rz, sx: -from.sx });
  save();
}

/** 导出的文本也放在面板里的文本框，剪贴板用不了时可以手动全选复制（桌面版没有 window.prompt） */
const exported = ref('');
async function copy(text: string, what: string): Promise<void> {
  exported.value = text;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = `已复制${what}，直接粘贴发给我`;
  } catch {
    copied.value = '剪贴板用不了：在下面的文本框里 Ctrl+A、Ctrl+C';
  }
  window.setTimeout(() => (copied.value = ''), 4000);
}

const copyOne = () => copy(handFits.exportOne(gunId.value), `「${GUN_BY_ID[gunId.value]?.name ?? gunId.value}」`);
const copyAll = () => copy(handFits.exportAll(gunId.value), '全部');

// 改了就生效 + 存起来
watch(
  fit,
  () => {
    vm.tune.fitOverride = open.value ? fit : null;
    save();
  },
  { deep: true },
);
watch([freeze, ghost, ads, open], () => {
  vm.tune.freeze = open.value && freeze.value;
  vm.tune.ghost = open.value && ghost.value;
  vm.tune.forceAds = open.value && ads.value ? 1 : -1;
  vm.tune.fitOverride = open.value ? fit : null;
});

// 打开时：游戏暂停、放开鼠标，但不弹暂停菜单（假装还锁着指针、输入层停用，鼠标拖滑块不会转视角）
const before = { paused: false, assume: false };
function toggle(force = false): void {
  const input = props.app.input;
  if (!force && !open.value && !(ui.screen === 'play' || ui.screen === 'training')) return;
  open.value = !open.value;
  if (open.value) {
    before.paused = props.app.paused;
    before.assume = input.assumeLocked;
    props.app.paused = true;
    input.assumeLocked = true;
    input.enabled = false;
    input.releaseLock();
    load(vm.taczId || game.config.guns[game.player.weapon] || 'glock_17');
  } else {
    props.app.paused = before.paused;
    input.assumeLocked = before.assume;
    const playing = ui.screen === 'play' || ui.screen === 'training';
    input.enabled = playing;
    if (playing) input.requestLock();
  }
}

// 离开游戏界面（死亡结算、回大厅）时自动关掉，恢复暂停 / 输入状态
watch(
  () => ui.screen,
  (sc) => {
    if (open.value && sc !== 'play' && sc !== 'training') toggle(true);
  },
);

// 打开时如果游戏里换了枪（数字键），跟着切
let timer = 0;
onMounted(() => {
  window.addEventListener('keydown', onKey, true);
  timer = window.setInterval(() => {
    if (!open.value) return;
    const id = vm.taczId;
    if (id && id !== gunId.value && !pending) load(id);
    if (pending && id === pending) pending = '';
    loading.value = !!gunId.value && id !== gunId.value;
  }, 300);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true);
  window.clearInterval(timer);
  vm.tune.fitOverride = null;
  vm.tune.freeze = vm.tune.ghost = false;
  vm.tune.forceAds = -1;
});

function onKey(e: KeyboardEvent): void {
  if (e.code === 'F9' || (open.value && e.code === 'Escape')) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) toggle();
    return;
  }
  // 面板开着时别的按键都不给游戏（不会切枪、开工坊、弹暂停菜单）
  if (open.value) e.stopPropagation();
}

const fmt = (v: number, step: number) => (step >= 1 ? v.toFixed(0) : step >= 0.1 ? v.toFixed(1) : v.toFixed(2));
const set = (k: keyof HandFit, e: Event) => {
  hand.value[k] = Number((e.target as HTMLInputElement).value);
};
const nudge = (r: Row, d: number) => {
  hand.value[r.k] = Math.round(Math.min(r.max, Math.max(r.min, hand.value[r.k] + d * r.step)) * 1000) / 1000;
};
const CLS_NAME: Record<WeaponKind, string> = { pistol: '手枪', smg: '冲锋枪', shotgun: '霰弹枪', rifle: '步枪', sniper: '狙击', lmg: '轻机枪' };
</script>

<template>
  <div v-if="!open && (ui.screen === 'play' || ui.screen === 'training')" class="hf-hint">F9 · 手部调节</div>
  <div v-if="open" class="hf" @keydown.stop @mousedown.stop>
    <header>
      <b>手部调节</b>
      <span class="sub">改了马上生效，自动保存在本机</span>
      <button class="x" title="关闭（F9）" @click="toggle()">×</button>
    </header>

    <label class="gun">
      枪
      <select :value="gunId" :disabled="!canSwitch" @change="equip(($event.target as HTMLSelectElement).value)">
        <option v-for="g in guns" :key="g.id" :value="g.id">{{ CLS_NAME[g.cls] }} · {{ g.name }}{{ g.tuned ? ' ●' : '' }}</option>
      </select>
    </label>
    <div class="nav">
      <button :disabled="!canSwitch" @click="step(-1)">◀ 上一把</button>
      <span class="count">{{ idx + 1 }} / {{ guns.length }} · 已调 {{ tunedCount }}</span>
      <button :disabled="!canSwitch" @click="step(1)">下一把 ▶</button>
    </div>
    <p v-if="!canSwitch" class="warn">正式对局里只能调手上这把。要挨个调全部 {{ guns.length }} 把枪：回大厅进「训练场」再按 F9</p>
    <p v-else-if="loading" class="warn">模型加载中……</p>

    <div class="opts">
      <label><input v-model="freeze" type="checkbox" /> 定格动画</label>
      <label><input v-model="ads" type="checkbox" /> 举镜</label>
      <label><input v-model="ghost" type="checkbox" /> 显示原版方块手（蓝）</label>
    </div>

    <div class="row scale">
      <span class="name">手臂大小</span>
      <input type="range" min="0.4" max="2.5" step="0.01" :value="fit.scale" @input="fit.scale = Number(($event.target as HTMLInputElement).value)" />
      <span class="val">{{ fit.scale.toFixed(2) }}</span>
    </div>

    <div class="tabs">
      <button :class="{ on: side === 'L' }" @click="side = 'L'">左手（护木）</button>
      <button :class="{ on: side === 'R' }" @click="side = 'R'">右手（握把）</button>
    </div>

    <section v-for="grp in GROUPS" :key="grp.title">
      <h4>{{ grp.title }}</h4>
      <div v-for="r in grp.rows" :key="r.k" class="row">
        <span class="name">{{ r.name }}</span>
        <button class="n" @click="nudge(r, -1)">−</button>
        <input type="range" :min="r.min" :max="r.max" :step="r.step" :value="hand[r.k]" @input="set(r.k, $event)" />
        <button class="n" @click="nudge(r, 1)">+</button>
        <span class="val">{{ fmt(hand[r.k], r.step) }}</span>
      </div>
    </section>

    <div class="btns">
      <button @click="mirror">从{{ side === 'R' ? '左' : '右' }}手镜像</button>
      <button @click="resetHand">重置这只手</button>
      <button @click="resetGun">重置这把枪</button>
    </div>
    <div class="btns main">
      <button @click="copyOne">复制本枪参数</button>
      <button @click="copyAll">复制全部（发给我）</button>
    </div>
    <p v-if="copied" class="ok">{{ copied }}</p>
    <textarea v-if="exported" class="out" readonly :value="exported" @focus="($event.target as HTMLTextAreaElement).select()"></textarea>
    <p class="tip">游戏已暂停（F9 / Esc 关闭）。在训练场里调：用「上一把 / 下一把」挨个过，调过的枪后面有 ●。拖滑块或点 −/+ 微调；开「定格动画」对着一个姿势调，开「举镜」看瞄准时的手。换弹 / 检视动画里手会跟着方块动，参数是相对方块的偏移。全部调完点「复制全部」发给我；参数存在本机，关掉游戏再开也还在。</p>
  </div>
</template>

<style scoped>
.hf-hint {
  position: fixed;
  right: 8px;
  bottom: 4px;
  font: 11px/1.4 system-ui, sans-serif;
  color: rgba(220, 230, 240, 0.35);
  pointer-events: none;
  z-index: 60;
}
.hf {
  position: fixed;
  top: 12px;
  right: 12px;
  width: 360px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 10px 12px 12px;
  background: rgba(12, 16, 20, 0.92);
  border: 1px solid rgba(110, 200, 230, 0.35);
  border-radius: 6px;
  color: #dfe7ee;
  font: 12px/1.45 system-ui, 'Microsoft YaHei', sans-serif;
  z-index: 200;
  user-select: none;
}
header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
header b {
  font-size: 14px;
}
.sub {
  color: #8fa0ae;
  font-size: 11px;
  flex: 1;
}
.x {
  background: none;
  border: 0;
  color: #cfd8e0;
  font-size: 18px;
  cursor: pointer;
}
.gun {
  display: flex;
  gap: 8px;
  align-items: center;
}
.gun select {
  flex: 1;
  background: #1b232b;
  color: #e6edf3;
  border: 1px solid #36424e;
  padding: 3px;
}
.opts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 8px 0;
}
.nav {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.nav .count {
  flex: 1;
  text-align: center;
  color: #9fb2c0;
  font-variant-numeric: tabular-nums;
}
button:disabled,
select:disabled {
  opacity: 0.45;
  cursor: default;
}
.warn {
  color: #ffcf6a;
  margin: 6px 0 0;
  font-size: 11px;
}
.tabs {
  display: flex;
  gap: 6px;
  margin: 8px 0 4px;
}
.tabs button {
  flex: 1;
}
.tabs button.on {
  background: #2e6f86;
  border-color: #6fd0e8;
}
h4 {
  margin: 8px 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: #8fc9dc;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
}
.row .name {
  width: 56px;
  color: #b9c6d1;
}
.row input[type='range'] {
  flex: 1;
  min-width: 0;
}
.row .val {
  width: 40px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.scale .name {
  width: 60px;
}
button {
  background: #1f2830;
  color: #dfe7ee;
  border: 1px solid #3a4652;
  border-radius: 3px;
  padding: 3px 8px;
  cursor: pointer;
  font: inherit;
}
button:hover {
  border-color: #6fd0e8;
}
button.n {
  padding: 0 6px;
  height: 18px;
  line-height: 1;
}
.btns {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.btns button {
  flex: 1;
}
.btns.main button {
  background: #2a5d3f;
  border-color: #4fae78;
}
.ok {
  color: #7fe0a0;
  margin: 6px 0 0;
}
.out {
  width: 100%;
  height: 120px;
  margin-top: 6px;
  background: #0d1216;
  color: #bfe6c8;
  border: 1px solid #36424e;
  font: 11px/1.3 Consolas, monospace;
  user-select: text;
}
.tip {
  color: #7f8e9a;
  font-size: 11px;
  margin: 8px 0 0;
}
</style>
