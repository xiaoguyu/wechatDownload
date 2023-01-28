import { app, dialog, shell, ipcMain, BrowserWindow, OpenDialogOptions } from 'electron';
import { electronApp, is } from '@electron-toolkit/utils';
import Store from 'electron-store';
import axios from 'axios';
import md5 from 'blueimp-md5';
import * as mysql from 'mysql';
import * as AnyProxy from 'anyproxy';
import * as path from 'path';
import * as Readability from '@mozilla/readability';
import * as fs from 'fs';
import { HttpUtil, StrUtil, FileUtil, DateUtil } from './utils';
import { GzhInfo, ArticleInfo, DownloadOption, Service } from './service';

const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');
const store = new Store();
const service = new Service();
// html转markdown的TurndownService
const turndownService = service.createTurndownService();
// 下载数量限制
// 获取文章列表时，数量查过此限制不再继续获取列表，而是采集详情页后再继续获取列表
const DOWNLOAD_LIMIT = 10;
// 获取文章列表的url
const LIST_URL = 'https://mp.weixin.qq.com/mp/profile_ext?action=getmsg&f=json&count=10&is_ok=1';
// 插入数据库的sql
const TABLE_NAME = store.get('tableName') || 'wx_article';
const INSERT_SQL = `INSERT INTO ${TABLE_NAME} ( title, content, author, content_url, create_time, copyright_stat) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title = ? , create_time=?`;
const SELECT_SQL = `SELECT title, content, author, content_url, create_time FROM ${TABLE_NAME} WHERE create_time >= ? AND create_time <= ?`;

// 代理
let PROXY_SERVER: AnyProxy.ProxyServer;
let MAIN_WINDOW: BrowserWindow;
// 存储公众号信息的对象
let GZH_INFO: GzhInfo;
// 用于定时关闭代理的对象
let TIMER: NodeJS.Timeout;
// 数据库连接
let CONNECTION: mysql.Connection;

// 配置的保存文件的路径
console.log('store.path', store.path);

function createWindow(): void {
  MAIN_WINDOW = new BrowserWindow({
    title: 'wechatDownload',
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
  if (store.get('firstRun') === undefined) service.setDefaultSetting();

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
  // 根据url下载单篇文章
  ipcMain.on('download-one', (_event, url: string) => downloadOne(url));
  // 批量下载，开启公号文章监测
  ipcMain.on('monitor-article', () => monitorArticle());
  // 确认是否批量下载
  ipcMain.on('confirm-download', (_event, flgDownload: boolean) => {
    if (flgDownload) {
      batchDownloadFromWeb();
    } else {
      outputLog(`已取消下载！`, true);
      MAIN_WINDOW.webContents.send('download-fnish');
    }
  });
  // 测试数据库连接
  ipcMain.on('test-connect', async () => createMyqlConnection(true));

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
  // 数据库连接
  if (CONNECTION) {
    CONNECTION.end();
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

  // 初始化数据库连接
  createMyqlConnection();
  const articleInfo = new ArticleInfo(null, null, url);
  const downloadOption = service.loadDownloadOption();
  await axiosDlOne(articleInfo, downloadOption);

  outputLog('<hr />', true, true);
}

async function axiosDlOne(articleInfo: ArticleInfo, downloadOption: DownloadOption) {
  const response = await axios.get(articleInfo.contentUrl);
  if (response.status != 200) {
    outputLog(`下载失败，状态码：${response.status}, URL:${articleInfo.contentUrl}`, true);
    return;
  }
  articleInfo.html = response.data;
  await dlOne(articleInfo, downloadOption);
}

/*
 * 下载单个页面
 */
async function dlOne(articleInfo: ArticleInfo, downloadOption: DownloadOption, saveToDb = true) {
  // 预处理微信公号文章html
  if (!articleInfo.html) return;
  const url = articleInfo.contentUrl;
  const htmlStr = service.prepHtml(articleInfo.html);
  // 提取正文
  const doc = new JSDOM(htmlStr);
  const reader = new Readability.Readability(<Document>doc.window.document, { keepClasses: true });
  const article = reader.parse();
  if (!article) {
    outputLog('提取正文失败', true);
    return;
  }
  if (!articleInfo.title) articleInfo.title = article.title;
  if (!articleInfo.author) articleInfo.author = article.byline;

  // 创建保存文件夹和缓存文件夹
  const timeStr = articleInfo.datetime ? DateUtil.format(articleInfo.datetime, 'yyyy-MM-dd') + '-' : '';
  const saveDirName = StrUtil.strToDirName(article.title);
  const savePath = path.join(downloadOption.savePath || '', timeStr + saveDirName);
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  } else {
    // 跳过已有文章
    if (downloadOption.skinExist && downloadOption.skinExist == 1) {
      outputLog(`【${saveDirName}】已存在，跳过此文章`, true);
      return;
    }
  }
  const tmpPath = path.join(downloadOption.tmpPath || '', md5(url));
  if (!fs.existsSync(tmpPath)) {
    fs.mkdirSync(tmpPath, { recursive: true });
  }

  // 判断是否需要下载图片
  let content;
  let imgCount = 0;
  if (1 == downloadOption.dlImg) {
    await downloadImgToHtml(article.content, savePath, tmpPath).then((obj) => {
      content = obj.html;
      imgCount = obj.imgCount;
    });
  } else {
    content = article.content;
  }
  const $ = cheerio.load(content);
  const readabilityPage = $('#readability-page-1');
  // 插入原文链接
  readabilityPage.prepend(`<div>原文地址：<a href='${url}' target='_blank'>${article.title}</a></div>`);
  // 插入标题
  readabilityPage.prepend(`<h1>${article.title}</h1>`);

  // 判断是否保存markdown
  if (1 == downloadOption.dlMarkdown) {
    const markdownStr = turndownService.turndown($.html());
    fs.writeFile(path.join(savePath, 'index.md'), markdownStr, () => {});
    outputLog(`【${article.title}】保存Markdown完成`, true);
  }
  // 判断是否保存html
  if (1 == downloadOption.dlHtml) {
    // 添加样式美化
    $('head').append(service.getArticleCss());
    fs.writeFile(path.join(savePath, 'index.html'), $.html(), () => {});
    outputLog(`【${article.title}】保存HTML完成`, true);
  }
  // 判断是否保存到数据库
  if (1 == downloadOption.dlMysql && CONNECTION.state == 'authenticated' && saveToDb) {
    const modSqlParams = [articleInfo.title, articleInfo.html, articleInfo.author, articleInfo.contentUrl, articleInfo.datetime, articleInfo.copyrightStat, articleInfo.title, articleInfo.datetime];
    CONNECTION.query(INSERT_SQL, modSqlParams, function (err, _result) {
      if (err) {
        console.log('mysql插入失败', err.message);
      } else {
        console.log('mysql更新成功');
      }
    });
  }
  outputLog(`【${article.title}】下载完成，共${imgCount}张图，url：${url}`, true);
}

/*
 * 下载图片并替换src
 * html： 正文的html
 * articleUrl： 原文url
 * savePath: 保存文章的路径(已区分文章),例如: D://savePath//测试文章1
 * tmpPath： 缓存路径(已区分文章)，例如：D://tmpPathPath//6588aec6b658b2c941f6d51d0b1691b9
 */
async function downloadImgToHtml(html: string, savePath: string, tmpPath: string): Promise<{ html: string; imgCount: number }> {
  const $ = cheerio.load(html);
  const imgArr = $('img');
  const awaitArr: Promise<void>[] = [];
  let imgCount = 0;
  // 创建保存图片的文件夹
  const imgPath = path.join(savePath, 'img');
  if (imgArr.length > 0 && !fs.existsSync(imgPath)) {
    fs.mkdirSync(imgPath, { recursive: true });
  }

  imgArr.each(function (_i, elem) {
    const $ele = $(elem);
    // 文件后缀
    const fileSuf = $ele.attr('data-type') || 'jpg';
    // 文件url
    const fileUrl = $ele.attr('data-src');
    if (fileUrl) {
      imgCount++;
      const fileName = `${md5(fileUrl)}.${fileSuf}`;
      const dlPromise = FileUtil.downloadFile(fileUrl, tmpPath, fileName).then((_fileName) => {
        $ele.attr('src', path.join('img', fileName));
        // 图片下载完成之，将图片从缓存文件夹复制到需要保存的文件夹
        const resolveSavePath = path.join(imgPath, _fileName);
        if (!fs.existsSync(resolveSavePath)) {
          // 复制
          fs.copyFile(path.join(tmpPath, _fileName), resolveSavePath, (err) => {
            if (err) {
              console.log(err);
              console.log(`复制图片失败，名字：${_fileName}`);
              console.log('tmpPath', path.resolve(tmpPath, _fileName));
              console.log('resolveSavePath', resolveSavePath);
            }
          });
        }
      });
      awaitArr.push(dlPromise);
    }
  });
  for (const dlPromise of awaitArr) {
    await dlPromise;
  }
  return { html: $.html(), imgCount: imgCount };
}

/*
 * 开启公号文章监测
 */
async function monitorArticle() {
  if ('db' == store.get('dlSource')) {
    // 下载来源是数据库
    outputLog('下载来源为数据库');
    outputLog('正在初始化数据库连接...', true);
    batchDownloadFromDb();
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
            MAIN_WINDOW.webContents.send('confirm-title', title);

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
 * 批量下载（来源是数据库）
 */
async function batchDownloadFromDb() {
  const exeStartTime = performance.now();
  // 提前初始化数据库连接
  await createMyqlConnection();
  if (CONNECTION.state != 'authenticated') {
    outputLog('数据库初始化失败', true);
    MAIN_WINDOW.webContents.send('download-fnish');
    return;
  }

  const { startDate, endDate } = service.getTimeScpoe();
  const modSqlParams = [startDate, endDate];
  CONNECTION.query(SELECT_SQL, modSqlParams, async function (err, result) {
    if (err) {
      console.log('获取数据库数据失败', err.message);
      outputLog('获取数据库数据失败', true);
    } else {
      let articleCount = 0;
      const promiseArr: Promise<void>[] = [];
      const downloadOption = service.loadDownloadOption();
      for (const dbObj of result) {
        articleCount++;
        const articleInfo: ArticleInfo = service.dbObjToArticle(dbObj);
        promiseArr.push(dlOne(articleInfo, downloadOption, false));
        // 栅栏，防止一次性下载太多
        if (promiseArr.length > DOWNLOAD_LIMIT) {
          for (let i = 0; i < DOWNLOAD_LIMIT; i++) {
            const p = promiseArr.shift();
            await p;
          }
        }
      }
      // 栅栏，等待所有文章下载完成
      for (const articlePromise of promiseArr) {
        await articlePromise;
      }

      const exeEndTime = performance.now();
      const exeTime = (exeEndTime - exeStartTime) / 1000;
      outputLog(`批量下载完成，共${articleCount}篇文章，耗时${exeTime.toFixed(2)}秒`, true);
      outputLog('<hr/>', true, true);
    }
    MAIN_WINDOW.webContents.send('download-fnish');
  });
}

/*
 * 批量下载(来源是网络)
 */
async function batchDownloadFromWeb() {
  const { startDate, endDate } = service.getTimeScpoe();
  const downloadOption = service.loadDownloadOption();
  const articleArr: ArticleInfo[] = [];
  const exeStartTime = performance.now();
  // 提前初始化数据库连接
  await createMyqlConnection();
  // 获取文章列表
  const articleCount: number[] = [0];
  await downList(0, articleArr, startDate, endDate, downloadOption, articleCount);

  // downList中没下载完的，在这处理
  const promiseArr: Promise<void>[] = [];
  for (const article of articleArr) {
    promiseArr.push(axiosDlOne(article, downloadOption));
  }
  // 栅栏，等待所有文章下载完成
  for (const articlePromise of promiseArr) {
    await articlePromise;
  }

  const exeEndTime = performance.now();
  const exeTime = (exeEndTime - exeStartTime) / 1000;
  outputLog(`批量下载完成，共${articleCount[0]}篇文章，耗时${exeTime.toFixed(2)}秒`, true);
  outputLog('<hr/>', true, true);
  MAIN_WINDOW.webContents.send('download-fnish');
}

/*
 * 获取文章列表
 * nextOffset: 微信获取文章列表所需参数
 * articleArr：文章信息
 * startDate：过滤开始时间
 * endDate：过滤结束时间
 * downloadOption：下载配置
 * articleCount：文章数量
 */
async function downList(nextOffset: number, articleArr: ArticleInfo[], startDate: Date, endDate: Date, downloadOption: DownloadOption, articleCount: number[]) {
  const response = await axios.get(LIST_URL, {
    params: {
      __biz: GZH_INFO.biz,
      key: GZH_INFO.key,
      uin: GZH_INFO.uin,
      offset: nextOffset
    }
  });
  if (response.status != 200) {
    outputLog(`获取文章列表失败，状态码：${response.status}`, true);
    return;
  }
  const oldArticleLengh = articleArr.length;
  const dataObj = response.data;
  const errmsg = dataObj['errmsg'];
  if ('ok' != errmsg) {
    console.log('下载列表url', `${LIST_URL}&__biz=${GZH_INFO.biz}&key=${GZH_INFO.key}&uin=${GZH_INFO.uin}&offset=${nextOffset}`);
    outputLog(`获取文章列表失败，错误信息：${errmsg}`, true);
    return;
  }
  const generalMsgList = JSON.parse(dataObj['general_msg_list']);

  for (const generalMsg of generalMsgList['list']) {
    const commMsgInfo = generalMsg['comm_msg_info'];
    const appMsgExtInfo = generalMsg['app_msg_ext_info'];

    const dateTime = new Date(commMsgInfo['datetime'] * 1000);
    // 判断，如果小于开始时间，直接退出
    if (dateTime < startDate) {
      articleCount[0] = articleCount[0] + articleArr.length - oldArticleLengh;
      return;
    }
    // 如果大于结束时间，则不放入
    if (dateTime > endDate) continue;

    service.objToArticle(appMsgExtInfo, dateTime, articleArr);

    if (appMsgExtInfo['is_multi'] == 1) {
      for (const multiAppMsgItem of appMsgExtInfo['multi_app_msg_item_list']) {
        service.objToArticle(multiAppMsgItem, dateTime, articleArr);
      }
    }
  }
  articleCount[0] = articleCount[0] + articleArr.length - oldArticleLengh;
  outputLog(`正在获取文章列表，目前数量：${articleCount[0]}`, true);
  // 文章数量超过限制，则开始下载详情页
  while (articleArr.length >= DOWNLOAD_LIMIT) {
    const promiseArr: Promise<void>[] = [];
    for (let i = 0; i < DOWNLOAD_LIMIT; i++) {
      const article = articleArr.shift();
      if (article) {
        promiseArr.push(axiosDlOne(article, downloadOption));
      }
    }
    // 栅栏，等待所有文章下载完成
    for (const articlePromise of promiseArr) {
      await articlePromise;
    }
  }

  if (dataObj['can_msg_continue'] == 1) {
    await downList(dataObj['next_offset'], articleArr, startDate, endDate, downloadOption, articleCount);
  }
}
/*
 * 创建mysql数据库连接
 */
async function createMyqlConnection(flgTest = false) {
  if (1 != store.get('dlMysql')) return;
  if (CONNECTION) {
    CONNECTION.end();
  }

  CONNECTION = mysql.createConnection({
    host: <string>store.get('mysqlHost'),
    port: <number>store.get('mysqlPort'),
    user: <string>store.get('mysqlUser'),
    password: <string>store.get('mysqlPassword'),
    database: <string>store.get('mysqlDatabase'),
    charset: 'utf8mb4'
  });
  // 这里是想阻塞等待连接成功
  return new Promise((resolve, _reject) => {
    CONNECTION.connect(() => {
      const sql = 'show tables';
      CONNECTION.query(sql, (err) => {
        if (err) {
          console.log('mysql连接失败', err);
          if (flgTest) {
            MAIN_WINDOW.webContents.send('alert', '连接失败，请检查参数');
          } else {
            outputLog('数据库连接失败，请检查参数', true);
          }
        } else {
          if (flgTest) {
            MAIN_WINDOW.webContents.send('alert', '连接成功');
          } else {
            outputLog('数据库连接成功', true);
          }
        }
        resolve(CONNECTION);
      });
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
