/**
 * 开放世界共用的声音出口：整个页面只开一个 AudioContext（第一次按键 / 点鼠标以后才能出声）。
 * 各模块（武器、丧尸、天气、拾取）都从这里拿，接到 out 上；车的声音有自己的一套（vehicles/audio.ts）。
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

/** 拿 AudioContext（还没有用户手势时返回 null：这时候什么都别播） */
export function audio(): AudioContext | null {
  return ctx;
}

/** 所有声音接到这里（总音量） */
export function out(): GainNode | null {
  return master;
}

/** 在用户手势的事件里调用（main.ts 在第一次按键 / 点鼠标时调） */
export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

/** 两秒白噪声（枪声、雨声、脚步都用它做底） */
export function noise(): AudioBuffer | null {
  if (!ctx) return null;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/**
 * 一下短促的声音：滤过的噪声 + 可选的一个下滑的音（拾取、开罐头、挥空、打中）。
 * vol 0–1，dur 秒，freq = 滤波中心频率，tone = 音高（Hz，0 = 不要）
 */
export function blip(vol: number, dur: number, freq: number, tone = 0, pan = 0): void {
  const a = ctx;
  const n = noise();
  if (!a || !master || !n) return;
  const t = a.currentTime;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  let dst: AudioNode = g;
  if (pan) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    dst = p;
  }
  dst.connect(master);
  const src = a.createBufferSource();
  src.buffer = n;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 0.9;
  src.connect(f).connect(g);
  src.start(t, Math.random() * 1.5, dur + 0.02);
  if (tone > 0) {
    const o = a.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(tone, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, tone * 0.55), t + dur);
    const og = a.createGain();
    og.gain.setValueAtTime(vol * 0.6, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(og).connect(dst === g ? master : dst);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
