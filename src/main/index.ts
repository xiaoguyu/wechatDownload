import { app, dialog, shell, ipcMain, BrowserWindow, OpenDialogOptions } from 'electron';
import { electronApp, is } from '@electron-toolkit/utils';
import Store from 'electron-store';
import axios from 'axios';
import md5 from 'blueimp-md5';
import * as AnyProxy from 'anyproxy';
import * as path from 'path';
import * as Readability from '@mozilla/readability';
import * as fs from 'fs';
import { HttpUtil, StrUtil, FileUtil } from './utils';
import { GzhInfo, ArticleInfo, Service } from './service';

const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const turndownService = new TurndownService();
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
// console.log('store.path', store.path);

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
  // mainWindow.webContents.openDevTools();
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
      batchDownload();
    } else {
      outputLog(`已取消下载！`, true);
      MAIN_WINDOW.webContents.send('download-fnish');
    }
  });

  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
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

  await axiosDlOne(url);

  outputLog('<hr />', true, true);
}

async function axiosDlOne(url: string) {
  const response = await axios.get(url);
  if (response.status != 200) {
    outputLog(`下载失败，状态码：${response.status}, URL:${url}`, true);
    return;
  }
  await dlOne(url, response.data);
}

/*
 * 下载单个页面
 */
async function dlOne(url: string, html: string) {
  // 预处理微信公号文章html
  const htmlStr = service.prepHtml(html);
  // 提取正文
  const doc = new JSDOM(htmlStr);
  const reader = new Readability.Readability(<Document>doc.window.document);
  const article = reader.parse();
  if (!article) {
    outputLog('提取正文失败', true);
    return;
  }
  // 创建保存文件夹和缓存文件夹
  const savePath = path.join(<string>store.get('savePath'), StrUtil.strToDirName(article.title));
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  }
  const tmpPath = path.join(<string>store.get('tmpPath'), md5(url));
  if (!fs.existsSync(tmpPath)) {
    fs.mkdirSync(tmpPath, { recursive: true });
  }

  // 判断是否需要下载图片
  let content;
  let imgCount = 0;
  if (1 == store.get('dlImg')) {
    await downloadImgToHtml(article.content, savePath, tmpPath).then((obj) => {
      content = obj.html;
      imgCount = obj.imgCount;
    });
  } else {
    content = article.content;
  }
  // 插入标题
  const $ = cheerio.load(content);
  $('#readability-page-1').prepend(`<h1>${article.title}</h1>`);

  // 判断是否保存markdown
  if (1 == store.get('dlMarkdown')) {
    outputLog(`【${article.title}】保存Markdown完成`, true);
    const markdownStr = turndownService.turndown($.html());
    fs.writeFile(path.join(savePath, 'index.md'), markdownStr, () => {});
  }
  // 判断是否保存html
  if (1 == store.get('dlHtml')) {
    // 添加样式美化
    $('head').append(service.getArticleCss());
    fs.writeFile(path.join(savePath, 'index.html'), $.html(), () => {});
    outputLog(`【${article.title}】保存HTML完成`, true);
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
  // 创建保存图片的文件夹
  const imgPath = path.join(savePath, 'img');
  if (!fs.existsSync(imgPath)) {
    fs.mkdirSync(imgPath, { recursive: true });
  }

  const $ = cheerio.load(html);
  const imgArr = $('img');
  const awaitArr: Promise<void>[] = [];
  let imgCount = 0;
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
  if (!PROXY_SERVER) {
    PROXY_SERVER = createProxy();
  }
  // 开启代理
  AnyProxy.utils.systemProxyMgr.enableGlobalProxy('127.0.0.1', '8001');
  AnyProxy.utils.systemProxyMgr.enableGlobalProxy('127.0.0.1', '8001', 'https');
  outputLog(`代理开启成功，准备批量下载，请在微信打开任意一篇需要批量下载的公号的文章`);

  // 10秒之后自动关闭代理
  TIMER = setTimeout(() => {
    outputLog(`批量下载超时，未监测到公号文章！`, true);
    AnyProxy.utils.systemProxyMgr.disableGlobalProxy();
    MAIN_WINDOW.webContents.send('download-fnish');
  }, 10000);
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
 * 批量下载
 */
async function batchDownload() {
  const { startDate, endDate } = service.getTimeScpoe();
  const articleArr: ArticleInfo[] = [];
  // 获取文章列表
  await downList(0, articleArr, startDate, endDate);
  outputLog(`获取文章列表成功，共${articleArr.length}篇文章`, true);

  // 下载文章详情
  const promiseArr: Promise<void>[] = [];
  for (const article of articleArr) {
    outputLog(`开始下载文章【${article.title}】`, true);
    promiseArr.push(axiosDlOne(article.contentUrl));
  }
  // 栅栏，等待所有文章下载完成
  for (const articlePromise of promiseArr) {
    await articlePromise;
  }

  outputLog('批量下载完成', true);
  outputLog('<hr/>', true, true);
  MAIN_WINDOW.webContents.send('download-fnish');
}
/*
 * 获取文章列表
 */
async function downList(nextOffset: number, articleArr: ArticleInfo[], startDate: Date, endDate: Date) {
  const url = 'https://mp.weixin.qq.com/mp/profile_ext?action=getmsg&f=json&count=10&is_ok=1';
  const response = await axios.get(url, {
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
  const dataObj = response.data;
  const generalMsgList = JSON.parse(dataObj['general_msg_list']);

  for (const generalMsg of generalMsgList['list']) {
    const commMsgInfo = generalMsg['comm_msg_info'];
    const appMsgExtInfo = generalMsg['app_msg_ext_info'];

    const dateTime = new Date(commMsgInfo['datetime'] * 1000);
    // 判断，如果小于开始时间，直接退出
    if (dateTime < startDate) {
      return;
    }
    // 如果大于结束时间，则不放入
    if (dateTime > endDate) continue;

    objToArticle(appMsgExtInfo, dateTime, articleArr);

    if (appMsgExtInfo['is_multi'] == 1) {
      for (const multiAppMsgItem of appMsgExtInfo['multi_app_msg_item_list']) {
        objToArticle(multiAppMsgItem, dateTime, articleArr);
      }
    }
  }
  if (dataObj['can_msg_continue'] == 1) {
    await downList(dataObj['next_offset'], articleArr, startDate, endDate);
  }
}
/*
 * 将json转成ArticleInfo
 */
function objToArticle(jsonObj, dateTime: Date, articleArr: ArticleInfo[]) {
  const title = jsonObj['title'];
  const contentUrl = jsonObj['content_url'];
  if (contentUrl) {
    articleArr.push({ title: title, datetime: dateTime, contentUrl: contentUrl });
  }
}

/*
 * 输出日志到主页面
 * msg：输出的消息
 * append：是否追加
 * flgHtml：消息是否是html
 */
function outputLog(msg: string, append = false, flgHtml = false) {
  MAIN_WINDOW.webContents.send('output-log', msg, append, flgHtml);
}
