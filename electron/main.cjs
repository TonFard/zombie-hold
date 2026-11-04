// 桌面版外壳（Electron）：把 vite build 的 dist/ 用自定义协议 app:// 提供给窗口。
// 不用 file://：游戏要 fetch TACZ 模型和音效，file:// 下 fetch 会被拦；app:// 注册成标准安全协议后
// 和网页版一样有自己的源，localStorage（存档）、指针锁定、fetch 都照常工作。
// 用法：npm run desktop（先打包再启动）/ npm run desktop:dev（连 vite 开发服务器）/ npm run dist:win（出安装包）
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV = process.argv.includes('--dev');
const DEV_URL = 'http://127.0.0.1:5173/';
const DIST = path.join(__dirname, '..', 'dist');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; font-src 'self' data:";

// ---- 性能：用独立显卡、不限制后台、跳过显卡黑名单 ----
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// 切到别的窗口再回来时不要降帧 / 暂停计时器（游戏循环靠 requestAnimationFrame）
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// 只开一个窗口：存档在 localStorage 里，两个实例同时写会互相覆盖
if (!app.requestSingleInstanceLock()) app.quit();

/** app://game/<路径> → dist/<路径>；不允许跳出 dist（../ 之类） */
function serveDist() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString()).then((res) => {
      if (!file.endsWith('.html')) return res;
      // 页面只能加载自己（app://game）的脚本和资源；Vue 的运行时模板编译用不到 eval
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', CSP);
      return new Response(res.body, { status: res.status, headers });
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    fullscreen: !DEV,
    autoHideMenuBar: true,
    backgroundColor: '#05070a',
    title: '黎明',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 失去焦点时也保持满帧，回到游戏不会卡一下
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());

  // F11：全屏 / 窗口切换；F12：开发者工具（只在 --dev 下）
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.key === 'F12' && DEV) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  // 外部链接用系统浏览器打开，不在游戏窗口里跳转
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const ok = DEV ? url.startsWith(DEV_URL) : url.startsWith('app://game/');
    if (!ok) e.preventDefault();
  });

  void win.loadURL(DEV ? DEV_URL : 'app://game/index.html');
}

app.on('second-instance', () => {
  const [w] = BrowserWindow.getAllWindows();
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

app.whenReady().then(() => {
  if (!DEV) serveDist();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
