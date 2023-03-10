/// <reference types="electron-vite/node" />

import { app, dialog, shell, ipcMain, BrowserWindow, OpenDialogOptions, MessageBoxOptions } from 'electron';
import { electronApp, is } from '@electron-toolkit/utils';
import Store from 'electron-store';
import * as mysql from 'mysql';
import * as AnyProxy from 'anyproxy';
import * as path from 'path';
import * as os from 'os';
import { HttpUtil } from './utils';
import { GzhInfo, Service, NodeWorkerResponse, NwrEnum, DlEventEnum, DownloadOption } from './service';
import creatWorker from './worker?nodeWorker';

const _AnyProxy = require('anyproxy');
const cheerio = require('cheerio');
const store = new Store();
const service = new Service();

// 代理
let PROXY_SERVER: AnyProxy.ProxyServer;
let MAIN_WINDOW: BrowserWindow;
// 存储公众号信息的对象
let GZH_INFO: GzhInfo;
// 用于定时关闭代理的对象
let TIMER: NodeJS.Timeout;

// 配置的保存文件的路径
console.log('store.path', store.path);

function createWindow(): void {
  MAIN_WINDOW = new BrowserWindow({
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

  MAIN_WINDOW.on('ready-to-show', () => {
    MAIN_WINDOW.show();
  });

  MAIN_WINDOW.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR热加载
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    MAIN_WINDOW.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    MAIN_WINDOW.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 打开f12调试
  // MAIN_WINDOW.webContents.openDevTools();
}

app.whenReady().then(() => {
  // CA证书处理
  service.createCAFile();
  if (store.get('firstRun') === undefined) setDefaultSetting();

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.javaedit');

  // electron-store的api
  ipcMain.on('electron-store-get', (event, val) => {
    event.returnValue = store.get(val);
  });
  ipcMain.on('electron-store-set', async (_event, key, val) => {
    store.set(key, val);
  });
  // 选择路径
  ipcMain.on('show-open-dialog', (event, options: OpenDialogOptions, callbackMsg: string) => {
    const _win = BrowserWindow.fromWebContents(event.sender);
    if (_win) {
      dialog
        .showOpenDialog(_win, options)
        .then((result) => {
          if (!result.canceled) {
            // 路径信息回调
            event.sender.send('open-dialog-callback', callbackMsg, result.filePaths[0]);
            store.set(callbackMsg, result.filePaths[0]);
          }
        })
        .catch((err) => {
          console.log(err);
        });
    }
  });
  // 消息弹框
  ipcMain.on('show-message-box', (event, options: MessageBoxOptions) => {
    const _win = BrowserWindow.fromWebContents(event.sender);
    if (_win) {
      dialog.showMessageBox(_win, options);
    }
  });
  // 根据url下载单篇文章
  ipcMain.on('download-one', (_event, url: string) => downloadOne(url));
  // 批量下载，开启公号文章监测
  ipcMain.on('monitor-article', () => monitorArticle());
  // 测试数据库连接
  ipcMain.on('test-connect', async () => testMysqlConnection());

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (PROXY_SERVER) {
    PROXY_SERVER.close();
    // 关闭代理
    AnyProxy.utils.systemProxyMgr.disableGlobalProxy();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/*
 * 下载单个页面
 */
async function downloadOne(url: string) {
  outputLog(`正在下载文章，url：${url}`);
  // 开启线程下载
  createDlWorker(DlEventEnum.ONE, url);
}

/*
 * 创建下载文章的线程
 */
function createDlWorker(dlEvent: DlEventEnum, data?) {
  const worker = creatWorker({
    workerData: loadWorkerData(dlEvent, data)
  });

  worker.on('message', (message) => {
    const nwResp: NodeWorkerResponse = message;
    switch (nwResp.code) {
      case NwrEnum.SUCCESS:
      case NwrEnum.FAIL:
        outputLog(nwResp.message, true);
        break;
      case NwrEnum.ONE_FINISH:
        if (nwResp.message) outputLog(nwResp.message, true);
        outputLog('<hr />', true, true);
        break;
      case NwrEnum.BATCH_FINISH:
        if (nwResp.message) outputLog(nwResp.message, true);
        outputLog('<hr />', true, true);
        MAIN_WINDOW.webContents.send('download-fnish');
        break;
      case NwrEnum.CLOSE:
        // 关闭线程
        worker.terminate();
        break;
    }
  });

  worker.postMessage('');
}

/*
 * 开启公号文章监测
 */
async function monitorArticle() {
  if ('db' == store.get('dlSource')) {
    // 下载来源是数据库
    outputLog('下载来源为数据库');
    // 开启线程下载
    createDlWorker(DlEventEnum.BATCH_DB);
  } else {
    // 下载来源是网络
    if (!PROXY_SERVER) {
      PROXY_SERVER = createProxy();
    }
    // 开启代理
    AnyProxy.utils.systemProxyMgr.enableGlobalProxy('127.0.0.1', '8001');
    AnyProxy.utils.systemProxyMgr.enableGlobalProxy('127.0.0.1', '8001', 'https');
    outputLog('下载来源为网络');
    outputLog('代理开启成功，准备批量下载...', true);
    outputLog('请在微信打开任意一篇需要批量下载的公号的文章', true);
    outputLog('别偷懒，已经打开的不算...', true);

    // 10秒之后自动关闭代理
    TIMER = setTimeout(() => {
      outputLog('批量下载超时，未监测到公号文章！', true);
      AnyProxy.utils.systemProxyMgr.disableGlobalProxy();
      MAIN_WINDOW.webContents.send('download-fnish');
    }, 10000);
  }
}
/*
 * 创建代理
 */
function createProxy(): AnyProxy.ProxyServer {
  const options: AnyProxy.ProxyOptions = {
    port: 8001,
    forceProxyHttps: true,
    silent: true,
    rule: {
      summary: 'My Custom Rule',
      beforeSendResponse(requestDetail, responseDetail) {
        if (requestDetail.url.indexOf('https://mp.weixin.qq.com/s') == 0) {
          const uin = HttpUtil.getQueryVariable(requestDetail.url, 'uin');
          const biz = HttpUtil.getQueryVariable(requestDetail.url, '__biz');
          const key = HttpUtil.getQueryVariable(requestDetail.url, 'key');
          if (uin && biz && key) {
            GZH_INFO = new GzhInfo(biz, key, uin);
            const $ = cheerio.load(responseDetail.response.body);
            const title = $('h1').text().trim();
            outputLog(`已监测到【${title}】，请确认是否批量下载该文章所属公号`, true);
            if (!MAIN_WINDOW.focusable) {
              MAIN_WINDOW.focus();
            }
            // 页面弹框确认
            dialog
              .showMessageBox(MAIN_WINDOW, {
                type: 'info',
                title: '下载',
                message: '请确认是否批量下载该文章所属公号',
                buttons: ['取消', '确定']
              })
              .then((index) => {
                if (index.response === 1) {
                  // 开启线程下载
                  createDlWorker(DlEventEnum.BATCH_WEB, GZH_INFO);
                } else {
                  outputLog(`已取消下载！`, true);
                  MAIN_WINDOW.webContents.send('download-fnish');
                }
              });

            AnyProxy.utils.systemProxyMgr.disableGlobalProxy();
            if (TIMER) clearTimeout(TIMER);
          }
        }
        return responseDetail;
      }
    }
  };
  const proxyServer = new AnyProxy.ProxyServer(options);

  // proxyServer.on('ready', () => {
  //   outputLog(`代理开启成功，准备批量下载，请在微信打开任意一篇需要批量下载的公号的文章`);
  // });
  proxyServer.on('error', () => {
    outputLog(`代理开启失败，请重试`);
  });
  proxyServer.start();
  return proxyServer;
}

/*
 * 测试mysql数据库连接
 */
async function testMysqlConnection() {
  if (1 != store.get('dlMysql') && 'db' != store.get('dlSource')) return;

  const CONNECTION = mysql.createConnection({
    host: <string>store.get('mysqlHost'),
    port: <number>store.get('mysqlPort'),
    user: <string>store.get('mysqlUser'),
    password: <string>store.get('mysqlPassword'),
    database: <string>store.get('mysqlDatabase'),
    charset: 'utf8mb4'
  });
  CONNECTION.connect(() => {
    const sql = 'show tables';
    CONNECTION.query(sql, (err) => {
      if (err) {
        console.log('mysql连接失败', err);
        dialog.showMessageBox(MAIN_WINDOW, {
          type: 'error',
          message: '连接失败，请检查参数'
        });
      } else {
        dialog.showMessageBox(MAIN_WINDOW, {
          type: 'info',
          message: '连接成功'
        });
      }
      return CONNECTION;
    });
  });
}

/*
 * 输出日志到主页面
 * msg：输出的消息
 * append：是否追加
 * flgHtml：消息是否是html
 */
async function outputLog(msg: string, append = false, flgHtml = false) {
  MAIN_WINDOW.webContents.send('output-log', msg, append, flgHtml);
}

/*
 * 第一次运行，默认设置
 */
function setDefaultSetting() {
  const default_setting: DownloadOption = {
    firstRun: false,
    // 下载来源
    dlSource: 'web',
    // 下载为markdown
    dlMarkdown: 1,
    // 下载音频到本地
    dlAudio: 0,
    // 下载图片到本地
    dlImg: 0,
    // 跳过现有文章
    skinExist: 1,
    // 添加原文链接
    sourceUrl: 1,
    // 下载范围-全部
    dlScpoe: 'all',
    // 缓存目录
    tmpPath: path.join(os.tmpdir(), 'wechatDownload'),
    // 在安装目录下创建文章的保存路径
    savePath: path.join(path.dirname(app.getPath('exe')), 'savePath'),
    // CA证书路径
    caPath: _AnyProxy.utils.certMgr.getRootDirPath(),
    // mysql配置-端口
    mysqlHost: 'localhost',
    mysqlPort: 3306,
    mysqlUser: 'root',
    mysqlPassword: 'root'
  };

  for (const i in default_setting) {
    store.set(i, default_setting[i]);
  }
}

/*
 * 获取设置中心页面的配置
 */
function loadDownloadOption(): DownloadOption {
  const downloadOption = new DownloadOption();
  for (const key in downloadOption) {
    downloadOption[key] = store.get(key);
  }
  return downloadOption;
}
// 获取nodeWorker的配置
function loadWorkerData(dlEvent: DlEventEnum, data?) {
  const connectionConfig = {
    host: <string>store.get('mysqlHost'),
    port: <number>store.get('mysqlPort'),
    user: <string>store.get('mysqlUser'),
    password: <string>store.get('mysqlPassword'),
    database: <string>store.get('mysqlDatabase'),
    charset: 'utf8mb4'
  };
  return {
    connectionConfig: connectionConfig,
    downloadOption: loadDownloadOption(),
    tableName: store.get('tableName') || 'wx_article',
    dlEvent: dlEvent,
    data: data
  };
}
