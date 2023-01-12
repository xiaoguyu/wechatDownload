import { app } from 'electron';
import Store from 'electron-store';
import { StrUtil } from './utils';
import * as os from 'os';
import * as path from 'path';
import * as AnyProxy from 'anyproxy';

const _AnyProxy = require('anyproxy');
const cheerio = require('cheerio');
const store = new Store();

// 获取公号文章列表需要的信息
class GzhInfo {
  public biz: string;
  public key: string;
  public uin: string;

  constructor(biz, key, uin) {
    this.biz = biz;
    this.key = key;
    this.uin = uin;
  }
}
// 公号文章信息类
class ArticleInfo {
  public title?: string;
  public datetime?: Date;
  public contentUrl: string;
  public html?: string;

  constructor(title, datetime, contentUrl) {
    this.title = title;
    this.datetime = datetime;
    this.contentUrl = contentUrl;
  }
}
// 配置类
class DownloadOption {
  // 首次运行
  public firstRun?: boolean;
  // 下载为html
  public dlHtml?: number;
  // 下载为markdown
  public dlMarkdown?: number;
  // 下载图片到本地
  public dlImg?: number;
  // 跳过现有文章
  public skinExist?: number;
  // 是否添加原文链接
  public sourceUrl?: number;
  // 下载范围
  public dlScpoe?: string;
  // 下载开始时间
  public startDate?: string;
  // 下载结束时间
  public endDate?: string;
  // 保存路径
  public savePath?: string;
  // 缓存路径
  public tmpPath?: string;
  // CA证书路径
  public caPath?: string;
}
/*
 * 业务方法类
 */
class Service {
  /*
   * 获取开始时间和结束时间
   */
  public getTimeScpoe(): { startDate: Date; endDate: Date } {
    const scpoe = <string>store.get('dlScpoe');
    const now: Date = new Date();
    let startDate: Date = new Date();
    startDate.setTime(0);
    let endDate: Date = new Date();
    endDate.setHours(23, 59, 59, 0);

    const startDateStr = <string>store.get('startDate');
    const endDateStr = <string>store.get('endDate');
    switch (scpoe) {
      case 'one':
        startDate = now;
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'seven':
        startDate = now;
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = now;
        startDate.setHours(0, 0, 0, 0);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'diy':
        if (startDateStr) {
          startDate = new Date(startDateStr);
        }
        if (endDateStr) {
          endDate = new Date(endDateStr);
          endDate.setHours(23, 59, 59, 0);
        }
        break;
    }
    return { startDate: startDate, endDate: endDate };
  }

  /*
   * 第一次运行，默认设置
   */
  public setDefaultSetting() {
    const default_setting: DownloadOption = {
      firstRun: false,
      // 下载为markdown
      dlMarkdown: 1,
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
      caPath: _AnyProxy.utils.certMgr.getRootDirPath()
    };

    for (const i in default_setting) {
      store.set(i, default_setting[i]);
    }
  }
  /*
   * 获取配置
   */
  public loadDownloadOption(): DownloadOption {
    const downloadOption = new DownloadOption();
    for (const key in downloadOption) {
      downloadOption[key] = store.get(key);
    }
    return downloadOption;
  }
  /*
   * 预处理微信公号文章html
   */
  public prepHtml(html: string): string {
    const $ = cheerio.load(html);
    // 处理图片：1.将data-src赋值给src 2.提取style中的宽高
    const imgArr = $('img');
    imgArr.each((_i, elem) => {
      const $ele = $(elem);
      const dataSrc = $ele.attr('data-src');
      if (dataSrc) {
        $ele.attr('src', dataSrc);
      }
      const styleStr = $ele.attr('style');
      if (styleStr) {
        const width = StrUtil.getStyleWidth(styleStr);
        if (width) {
          $ele.attr('width', width);
        }
      }
    });
    return $.html();
  }
  /*
   * 美化保存成html的样式
   */
  public getArticleCss(): string {
    return `
      <style type="text/css">
      .page {
        max-width: 677px;
        margin-left: auto;
        margin-right: auto;
      }
      h1,h2 {
        text-align: center;
      }
      .page img {
        max-width: 100%;
        margin: 0 auto;
        display: block;
      }
      .code-snippet__fix {
        font-size: 14px;
        margin: 10px 0;
        display: block;
        color: #333;
        position: relative;
        background-color: rgba(0,0,0,.03);
        border: 1px solid #f0f0f0;
        border-radius: 2px;
        display: -ms-flexbox;
        display: flex;
        line-height: 26px;
      }
      .code-snippet__fix .code-snippet__line-index {
          counter-reset: line;
          -ms-flex-negative: 0;
          flex-shrink: 0;
          height: 100%;
          padding: 1em;
          list-style-type: none;
      }
      .code-snippet__fix .code-snippet__line-index li {
          list-style-type: none;
          text-align: right;
      }
      .code-snippet__fix .code-snippet__line-index li:before {
        min-width: 1.5em;
        text-align: right;
        left: -2.5em;
        counter-increment: line;
        content: counter(line);
        display: inline;
        color: rgba(0,0,0,.15);
      }
      .code-snippet__fix pre {
          overflow-x: auto;
          padding: 1em 1em 1em 0;
          white-space: normal;
          -ms-flex: 1;
          flex: 1;
          -webkit-overflow-scrolling: touch;
      }
      .code-snippet__fix code {
          text-align: left;
          font-size: 14px;
          display: block;
          white-space: pre;
          display: -ms-flexbox;
          display: flex;
          position: relative;
          font-family: Consolas,Liberation Mono,Menlo,Courier,monospace;
      }
      </style>
    `;
  }
  /*
   * 创建CA证书
   * 如果没有创建ca证书，则创建，默认目录在C:\Users\xxx\.anyproxy\certificates
   */
  public createCAFile() {
    if (!AnyProxy.utils.certMgr.ifRootCAFileExists()) {
      AnyProxy.utils.certMgr.generateRootCA((error, keyPath) => {
        if (!error) {
          const certDir = path.dirname(keyPath);
          console.log('CA证书创建成功，路径：', certDir);
        } else {
          console.error('CA证书创建失败', error);
        }
      });
    }
  }
  /*
   * 创建html转markdown的TurndownService
   */
  public createTurndownService() {
    const TurndownService = require('turndown');
    const turndownService = new TurndownService({ codeBlockStyle: 'fenced' });
    // 专门针对微信公号文章页面做得规则
    turndownService.addRule('pre', {
      filter: function (node, options) {
        let isCodeBlock = false;
        for (const childNode of node.childNodes) {
          if (childNode.nodeName === 'CODE') {
            isCodeBlock = true;
            break;
          }
        }
        return options.codeBlockStyle === 'fenced' && node.nodeName === 'PRE' && isCodeBlock;

        // return options.codeBlockStyle === 'fenced' && node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE';
      },

      replacement: function (_content, node: HTMLElement, options) {
        let codeNode;
        let language;
        const codeArr: string[] = [];
        for (const childNode of node.childNodes) {
          if (childNode.nodeName === 'CODE') {
            codeNode = childNode.cloneNode(true);

            if (!language) {
              const className = codeNode.getAttribute('class') || '';
              language = (className.match(/language-(\S+)/) || [null, ''])[1];
            }

            const innerHTMLStr = codeNode.innerHTML.replaceAll('<br>', '\n');
            codeNode.innerHTML = innerHTMLStr;
            codeArr.push(codeNode.textContent);
          }
        }
        const code = codeArr.join('\n');

        if (!language) {
          language = node.getAttribute('data-lang');
        }

        const fenceChar = options.fence.charAt(0);
        let fenceSize = 3;
        const fenceInCodeRegex = new RegExp('^' + fenceChar + '{3,}', 'gm');

        let match;
        while ((match = fenceInCodeRegex.exec(code))) {
          if (match[0].length >= fenceSize) {
            fenceSize = match[0].length + 1;
          }
        }

        const fence = Array(fenceSize + 1).join(fenceChar);

        return '\n\n' + fence + (language || '') + '\n' + code.replace(/\n$/, '') + '\n' + fence + '\n\n';
      }
    });

    return turndownService;
  }
  /*
   * 将json转成ArticleInfo
   */
  public objToArticle(jsonObj, dateTime: Date, articleArr: ArticleInfo[]) {
    const title = jsonObj['title'];
    const contentUrl = jsonObj['content_url'];
    if (contentUrl) {
      articleArr.push({ title: title, datetime: dateTime, contentUrl: contentUrl });
    }
  }
}

export { GzhInfo, ArticleInfo, DownloadOption, Service };
