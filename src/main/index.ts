import { app, dialog, shell, ipcMain, BrowserWindow, OpenDialogOptions, MessageBoxOptions } from 'electron';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import Store from 'electron-store';
import * as mysql from 'mysql2';
import * as AnyProxy from 'anyproxy';
import * as path from 'path';
import * as os from 'os';
import { HttpUtil } from './utils';
import logger from './logger';
import { GzhInfo, ArticleInfo, PdfInfo, NodeWorkerResponse, NwrEnum, DlEventEnum, DownloadOption } from './service';
import creatWorker from './worker?nodeWorker';
import createEpubWorker from './epubWorker?nodeWorker';
import * as fs from 'fs';
import icon from '../../resources/icon.png?asset';
import * as child_process from 'child_process';
import * as iconv from 'iconv-lite';

import electronUpdater, { type AppUpdater, type UpdateInfo } from 'electron-updater';

export function getAutoUpdater(): AppUpdater {
  // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.
  // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.
  const { autoUpdater } = electronUpdater;
  return autoUpdater;
}
const autoUpdater = getAutoUpdater();

const exec = child_process.exec;
const store = new Store();
// const service = new Service();

// 代理
let PROXY_SERVER: AnyProxy.ProxyServer;
let MAIN_WINDOW: BrowserWindow;
// 存储公众号信息的对象
let GZH_INFO: GzhInfo;
// 用于定时关闭代理的对象
let TIMER: NodeJS.Timeout;
let DL_TYPE = DlEventEnum.BATCH_WEB;
let articleArr;

// 配置的保存文件的路径
logger.debug('store.path', store.path);

function createWindow(): void {
  MAIN_WINDOW = new BrowserWindow({
    width: 900,
    height: 680,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  MAIN_WINDOW.setMenu(null);

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
  setDefaultSetting();

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.javaedit');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 安装证书
  ipcMain.on('install-licence', () => {
    installCAFile(path.join(<string>store.get('caPath'), 'rootCA.crt'));
  });
  // 打开日志文件夹
  ipcMain.on('open-logs-dir', () => {
    shell.openPath(path.join(app.getPath('appData'), 'wechatDownload', 'logs'));
  });
  // electron-store的api
  ipcMain.on('electron-store-get', (event, val) => {
    event.returnValue = store.get(val);
  });
  ipcMain.on('electron-store-set', async (_event, key, val) => {
    logger.info('change setting', key, val);
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
          logger.error(err);
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
  // 批量下载，开启公号文章监测，获取用户参数
  ipcMain.on('monitor-article', () => monitorArticle());
  // 批量下载，开启公号文章监测，获取用户参数和文章地址
  ipcMain.on('monitor-limit-article', () => monitorLimitArticle());
  ipcMain.on('stop-monitor-limit-article', () => stopMonitorLimitArticle());
  // 测试数据库连接
  ipcMain.on('test-connect', async () => testMysqlConnection());
  // 检查更新
  ipcMain.on('check-for-update', () => {
    logger.info('触发检查更新');
    autoUpdater.checkForUpdates();
  });
  // 返回初始化页面需要的信息
  ipcMain.on('load-init-info', (event) => {
    // 暂时只需要版本号
    event.returnValue = app.getVersion();
  });
  // 生成epub
  ipcMain.on('create-epub', (_event, options: any) => {
    options.tmpPath = store.get('tmpPath');
    const epubWorker = createEpubWorker({
      workerData: options
    });

    epubWorker.on('message', (message) => {
      const nwResp: NodeWorkerResponse = message;
      switch (nwResp.code) {
        case NwrEnum.SUCCESS:
        case NwrEnum.FAIL:
          outputLog(nwResp.message, true);
          break;
        case NwrEnum.CLOSE:
          outputEpubLog('<hr />', true, true);
          // 关闭线程
          epubWorker.terminate();
      }
    });

    outputLog('生成Epub线程启动中');
    epubWorker.postMessage(new NodeWorkerResponse(NwrEnum.START, ''));
  });

  createWindow();

  // CA证书处理
  createCAFile();

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
 * 创建CA证书
 * 如果没有创建ca证书，则创建，默认目录在C:\Users\xxx\.anyproxy\certificates
 */
function createCAFile() {
  if (!AnyProxy.utils.certMgr.ifRootCAFileExists()) {
    AnyProxy.utils.certMgr.generateRootCA((error, keyPath) => {
      if (!error) {
        const certDir = path.dirname(keyPath);
        logger.info('CA证书创建成功，路径：', certDir);
        // 安装证书
        installCAFile(path.join(certDir, 'rootCA.crt'));
      } else {
        logger.error('CA证书创建失败', error);
        dialog.showMessageBox(MAIN_WINDOW, {
          type: 'error',
          message: '证书创建失败'
        });
      }
    });
  }
}

/**
 * 安装ca证书
 * @param filePath 证书路径
 */
function installCAFile(filePath: string) {
  // 如果是window系统，则自动安装证书
  if (process.platform === 'win32') {
    exec(`certutil -addstore root ${filePath}`, { encoding: 'buffer' }, (err, _stdout, stderr) => {
      if (err) {
        logger.error('CA证书安装失败-stderr', iconv.decode(stderr, 'cp936'));
        logger.error('CA证书安装失败-err', err);
        dialog.showMessageBox(MAIN_WINDOW, {
          type: 'error',
          message: '证书安装失败，请以管理员身份运行本软件重新安装证书或手动安装'
        });
      } else {
        logger.info('CA证书安装成功');
        dialog
          .showMessageBox(MAIN_WINDOW, {
            type: 'info',
            message: '证书安装成功，准备重启软件'
          })
          .then(() => {
            app.relaunch();
            app.exit();
          });
      }
    });
  } else {
    dialog.showMessageBox(MAIN_WINDOW, {
      type: 'error',
      message: '不是window系统，请手动安装'
    });
  }
}

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
let worker;
function createDlWorker(dlEvent: DlEventEnum, data?) {
  worker = creatWorker({
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
      case NwrEnum.PDF:
        html2Pdf(nwResp.data);
    }
  });

  worker.postMessage(new NodeWorkerResponse(NwrEnum.START, ''));
}

async function html2Pdf(pdfInfo: PdfInfo) {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800
  });

  const htmlPath = path.join(pdfInfo.savePath, 'pdf.html');
  pdfWindow.loadFile(htmlPath);

  pdfWindow.webContents.on('did-finish-load', () => {
    pdfWindow.webContents
      .printToPDF({})
      .then((data) => {
        const fileName = pdfInfo.fileName || 'index';
        fs.writeFileSync(path.join(pdfInfo.savePath, `${fileName}.pdf`), data);
        outputLog(`【${pdfInfo.title}】保存PDF完成`, true);
      })
      .catch((error) => {
        logger.error(`保存PDF失败:${pdfInfo.title}`, error);
        outputLog(`【${pdfInfo.title}】保存PDF失败`, true);
      })
      .finally(() => {
        pdfWindow.close();
        fs.unlink(htmlPath, () => {});
        // 任务完成，通知worker线程
        worker?.postMessage(new NodeWorkerResponse(NwrEnum.PDF_FINISHED, '', pdfInfo.id));
      });
  });
}

/*
 * 开启公号文章监测,获取用户参数
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
    DL_TYPE = DlEventEnum.BATCH_WEB;
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
    }, 15000);
  }
}
/*
 * 开启公号文章监测,获取文章地址和用户参数
 */
async function monitorLimitArticle() {
  if (!PROXY_SERVER) {
    PROXY_SERVER = createProxy();
  }
  DL_TYPE = DlEventEnum.BATCH_SELECT;
  articleArr = [];
  // 开启代理
  AnyProxy.utils.systemProxyMgr.enableGlobalProxy('127.0.0.1', '8001');
  AnyProxy.utils.systemProxyMgr.enableGlobalProxy('127.0.0.1', '8001', 'https');
  outputLog('代理开启成功，准备监控下载...');
  outputLog('请在微信打开需要下载的文章，可打开多篇文章', true);
  outputLog('<p>最后再点击一次 <strong>监控下载</strong> 按钮即可开始下载</p>', true, true);
}

async function stopMonitorLimitArticle() {
  // 关闭代理
  AnyProxy.utils.systemProxyMgr.disableGlobalProxy();

  // 开启线程下载
  if (articleArr && articleArr.length > 0) {
    outputLog(`已获取${articleArr.length}篇文章，准备下载...`, true);
    createDlWorker(DlEventEnum.BATCH_SELECT, articleArr);
  } else {
    outputLog('获取文章失败', true);
  }
  articleArr = [];
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
        // 批量下载
        if (DL_TYPE == DlEventEnum.BATCH_WEB && requestDetail.url.indexOf('https://mp.weixin.qq.com/mp/getbizbanner') == 0) {
          const uin = HttpUtil.getQueryVariable(requestDetail.url, 'uin');
          const biz = HttpUtil.getQueryVariable(requestDetail.url, '__biz');
          const key = HttpUtil.getQueryVariable(requestDetail.url, 'key');
          const passTicket = HttpUtil.getQueryVariable(requestDetail.url, 'pass_ticket');
          if (uin && biz && key) {
            GZH_INFO = new GzhInfo(biz, key, uin);
            GZH_INFO.passTicket = passTicket;
            const headers = requestDetail.requestOptions.headers;
            if (headers) {
              GZH_INFO.Host = headers['Host'] as string;
              GZH_INFO.Cookie = headers['Cookie'] as string;
              GZH_INFO.UserAgent = headers['User-Agent'] as string;
            }

            logger.debug('微信公号参数', GZH_INFO);
            outputLog(`已监测到文章，请确认是否批量下载该文章所属公号`, true);
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
          } else {
            logger.error('微信公号参数获取失败', requestDetail);
          }
        }
        // 单条下载
        if (DL_TYPE == DlEventEnum.BATCH_SELECT && requestDetail.url.indexOf('https://mp.weixin.qq.com/mp/geticon') == 0) {
          const headers = requestDetail.requestOptions.headers;
          if (headers) {
            const referer = headers['Referer'] as string;
            const uin = HttpUtil.getQueryVariable(referer, 'uin');
            const biz = HttpUtil.getQueryVariable(referer, '__biz');
            const key = HttpUtil.getQueryVariable(referer, 'key');
            const mid = HttpUtil.getQueryVariable(referer, 'mid');
            const sn = HttpUtil.getQueryVariable(referer, 'sn');
            const chksm = HttpUtil.getQueryVariable(referer, 'chksm');
            const idx = HttpUtil.getQueryVariable(referer, 'idx');
            const gzhInfo = new GzhInfo(biz, key, uin);
            gzhInfo.Cookie = headers['Cookie'] as string;
            gzhInfo.UserAgent = headers['User-Agent'] as string;

            const articleUrl = `http://mp.weixin.qq.com/s?__biz=${biz}&amp;mid=${mid}&amp;idx=${idx}&amp;sn=${sn}&amp;chksm=${chksm}&amp;scene=27#wechat_redirect`;

            const articleInfo = new ArticleInfo(null, null, '');
            articleInfo.contentUrl = articleUrl;
            articleInfo.gzhInfo = gzhInfo;

            articleArr.push(articleInfo);

            outputLog(`已获取文章，mid：${mid}`, true);
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
  const sql = 'show tables';
  CONNECTION.query(sql, (err) => {
    if (err) {
      logger.error('mysql连接失败', err);
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
 * 输出日志到生成Epub页面
 * msg：输出的消息
 * append：是否追加
 * flgHtml：消息是否是html
 */
async function outputEpubLog(msg: string, append = false, flgHtml = false) {
  MAIN_WINDOW.webContents.send('output-epub-log', msg, append, flgHtml);
}
/*
 * 第一次运行，默认设置
 */
function setDefaultSetting() {
  const default_setting: DownloadOption = {
    firstRun: false,
    // 下载来源
    dlSource: 'web',
    // 线程类型
    threadType: 'multi',
    // 下载间隔
    dlInterval: 500,
    // 单批数量
    batchLimit: 10,
    // 下载为html
    dlHtml: 1,
    // 下载为markdown
    dlMarkdown: 1,
    // 下载为pdf
    dlPdf: 0,
    // 保存至mysql
    dlMysql: 0,
    // 下载音频到本地
    dlAudio: 0,
    // 下载图片到本地
    dlImg: 0,
    // 跳过现有文章
    skinExist: 1,
    // 是否保存元数据
    saveMeta: 1,
    // 按公号名字分类
    classifyDir: 1,
    // 添加原文链接
    sourceUrl: 1,
    // 是否下载评论
    dlComment: 0,
    // 是否下载评论回复
    dlCommentReply: 0,
    // 下载范围-7天内
    dlScpoe: 'seven',
    // 缓存目录
    tmpPath: path.join(os.tmpdir(), 'wechatDownload'),
    // 在安装目录下创建文章的保存路径
    savePath: path.join(app.getPath('userData'), 'savePath'),
    // CA证书路径
    caPath: (AnyProxy as any).utils.certMgr.getRootDirPath(),
    // mysql配置-端口
    mysqlHost: 'localhost',
    mysqlPort: 3306
  };

  for (const i in default_setting) {
    sotreSetNotExit(i, default_setting[i]);
  }
}

function sotreSetNotExit(key, value): boolean {
  const oldValue = store.get(key);
  if (oldValue === '' || oldValue === null || oldValue === undefined) {
    store.set(key, value);
    logger.info('setting', key, value);
    return true;
  }
  logger.info('setting', key, oldValue);
  return false;
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

/*******************以下是自动更新相关************************/

// 这里是为了在本地做应用升级测试使用
// if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
//   autoUpdater.updateConfigPath = path.join(__dirname, '../../dev-app-update.yml');
// }
// Object.defineProperty(app, 'isPackaged', {
//   get() {
//     return true;
//   }
// });

// 定义返回给渲染层的相关提示文案
const updateMessage = {
  error: { code: 1, msg: '检查更新出错' },
  checking: { code: 2, msg: '正在检查更新……' },
  updateAva: { code: 3, msg: '检测到新版本，正在下载……' },
  updateNotAva: { code: 4, msg: '现在使用的就是最新版本，不用更新' }
};

function sendUpdateMessage(msg: any) {
  MAIN_WINDOW.webContents.send('update-msg', msg);
}

// 设置自动下载为false，也就是说不开始自动下载
autoUpdater.autoDownload = false;
// 检测下载错误
autoUpdater.on('error', (error) => {
  logger.error('更新异常', error);
  sendUpdateMessage(updateMessage.error);
});

// 检测是否需要更新
autoUpdater.on('checking-for-update', () => {
  logger.info(updateMessage.checking);
  sendUpdateMessage(updateMessage.checking);
});
// 检测到可以更新时
autoUpdater.on('update-available', (releaseInfo: UpdateInfo) => {
  const releaseNotes = releaseInfo.releaseNotes;
  let releaseContent = '';
  if (releaseNotes) {
    if (typeof releaseNotes === 'string') {
      releaseContent = <string>releaseNotes;
    } else if (releaseNotes instanceof Array) {
      releaseNotes.forEach((releaseNote) => {
        releaseContent += `${releaseNote}\n`;
      });
    }
  } else {
    releaseContent = '暂无更新说明';
  }
  dialog
    .showMessageBox({
      type: 'info',
      title: '应用有新的更新',
      detail: releaseContent,
      message: '发现新版本，是否现在更新？',
      buttons: ['否', '是']
    })
    .then(({ response }) => {
      if (response === 1) {
        sendUpdateMessage(updateMessage.updateAva);
        // 下载更新
        autoUpdater.downloadUpdate();
      }
    });
});
// 检测到不需要更新时
autoUpdater.on('update-not-available', () => {
  logger.info(updateMessage.updateNotAva);
  sendUpdateMessage(updateMessage.updateNotAva);
});
// 更新下载进度
autoUpdater.on('download-progress', (progress) => {
  MAIN_WINDOW.webContents.send('download-progress', progress);
});
// 当需要更新的内容下载完成后
autoUpdater.on('update-downloaded', () => {
  logger.info('下载完成，准备更新');
  dialog
    .showMessageBox({
      title: '安装更新',
      message: '更新下载完毕，应用将重启并进行安装'
    })
    .then(() => {
      // 退出并安装应用
      setImmediate(() => autoUpdater.quitAndInstall());
    });
});
