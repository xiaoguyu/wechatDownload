import { app, shell, ipcMain, BrowserWindow } from 'electron';
import { electronApp, is } from '@electron-toolkit/utils';
import Store from 'electron-store';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const store = new Store();

console.log('store.path', store.path);

// 创建文件夹
// if (!fs.existsSync(tmpDirPath)) fs.mkdir(tmpDirPath, () => {});

const default_setting = {
  firstRun: false,
  dlMarkdown: 1,
  // 缓存目录
  tmpPath: path.join(os.tmpdir(), 'wechatDownload'),
  // 在安装目录下创建文章的保存路径
  savePath: path.join(path.dirname(app.getPath('exe')), 'savePath')
};

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux'
      ? {
          icon: path.join(__dirname, '../../build/icon.png')
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 打开f12调试
  mainWindow.webContents.openDevTools();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  if (store.get('firstRun') === undefined) setDefaultSetting();

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.javaedit');

  // electron-store的api
  ipcMain.on('electron-store-get', async (event, val) => {
    event.returnValue = store.get(val);
  });
  ipcMain.on('electron-store-set', async (_event, key, val) => {
    store.set(key, val);
  });

  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function setDefaultSetting() {
  for (const i in default_setting) {
    store.set(i, default_setting[i]);
  }
}
