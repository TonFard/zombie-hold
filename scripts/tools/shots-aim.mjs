// 生成截图步骤：对准地图里某种道具的第 n 个，从 dist 米外、给定方位角看过去
// node scripts/tools/shots-aim.mjs out.json car:0:6:0.6 container:4:8:2.2 ...  （种类:序号:距离:方位角弧度[:俯仰]）
// 每一步先等写实道具加载完（view.realReady），再暂停模拟、摆好玩家、等 3 秒出图
import fs from 'node:fs';

const [out, ...specs] = process.argv.slice(2);
const wait = `(async()=>{for(let i=0;i<120&&!(__app.view.realReady);i++)await new Promise(r=>setTimeout(r,500));__app.paused=true;return __app.view.realReady})()`;
const steps = [{ wait: 6000 }, { eval: wait }];
for (const s of specs) {
  const [kind, n, dist, ang, pitch] = s.split(':');
  const name = `aim_${kind}${n}_${dist}`;
  steps.push({
    eval: `(()=>{const m=__app.game.map;const ps=m.props.filter(p=>p.kind==='${kind}');const p=ps[${Number(n)}];if(!p)return 'none';const W=m.grid.w/2,H=m.grid.h/2;const cx=(p.x0+p.x1)/2-W,cz=(p.y0+p.y1)/2-H;const a=${Number(ang)},d=${Number(dist)};const pl=__app.game.player;pl.x=cx+Math.sin(a)*d;pl.z=cz+Math.cos(a)*d;pl.yaw=Math.atan2(cx-pl.x,cz-pl.z);pl.pitch=${pitch ?? -0.18};return [ps.length,Math.round(cx),Math.round(cz)]})()`,
  });
  steps.push({ wait: 3000 }, { shot: name });
}
fs.writeFileSync(out, JSON.stringify(steps));
console.log(`${out}: ${specs.length} shots`);
