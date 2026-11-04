// 启动桌面版。VS Code 的终端会设置 ELECTRON_RUN_AS_NODE=1，带着它启动 electron 会变成普通 Node，
// require('electron') 拿不到 app，这里先去掉再启动
const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const p = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: false });
p.on('exit', (code) => process.exit(code ?? 0));
