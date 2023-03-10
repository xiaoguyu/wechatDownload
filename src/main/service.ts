import { StrUtil } from './utils';
import * as path from 'path';
import * as AnyProxy from 'anyproxy';

const cheerio = require('cheerio');

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
  // 标题
  public title?: string;
  // 事件
  public datetime?: Date;
  // 详情url
  public contentUrl: string;
  // html源码
  public html?: string;
  // 作者
  public author?: string;
  public copyrightStat?: number;

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
  // 下载来源
  public dlSource?: string;
  // 下载为html
  public dlHtml?: number;
  // 下载为markdown
  public dlMarkdown?: number;
  // 保存至mysql
  public dlMysql?: number;
  // 下载音频到本地
  public dlAudio?: number;
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
  // mysql配置-主机
  public mysqlHost?: string;
  // mysql配置-端口
  public mysqlPort?: number;
  // mysql配置-用户名
  public mysqlUser?: string;
  // mysql配置-密码
  public mysqlPassword?: string;
}
// nodeWorker交互使用的通用消息响应类
class NodeWorkerResponse {
  public code: number;
  public message: string;
  public data?: any;
  constructor(code: number, message: string, data?) {
    this.code = code;
    this.message = message;
    this.data = data;
  }
}
// NodeWorkerResponse的code枚举类
enum NwrEnum {
  SUCCESS, // 成功，输出日志
  FAIL, // 失败，输出日志并失败处理
  ONE_FINISH, // 单个下载结束，输出日志并做结束处理
  BATCH_FINISH, // 多个下载结束，输出日志并做结束处理
  CLOSE // 结束线程
}
// 下载事件枚举类
enum DlEventEnum {
  ONE, // 下载单篇文章
  BATCH_WEB, // 微信接口批量下载
  BATCH_DB // 数据库批量下载
}
/*
 * 业务方法类
 */
class Service {
  /*
   * 获取开始时间和结束时间
   */
  public getTimeScpoe(downloadOption: DownloadOption): { startDate: Date; endDate: Date } {
    const scpoe = downloadOption.dlScpoe;
    const now: Date = new Date();
    let startDate: Date = new Date();
    startDate.setTime(0);
    let endDate: Date = new Date();
    endDate.setHours(23, 59, 59, 0);

    const startDateStr = downloadOption.startDate;
    const endDateStr = downloadOption.endDate;
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
      .music-div audio {
        min-width: 300px;
        width: 100%;
        height: 30px;
      }
      .music-div {
        display: flex;
        background-color: #f1f3f4;
        align-items: center;
        padding: 8px 8px 8px 20px;
        margin: 10px 0;
      }
      .audio-dev {
        flex: 1;
      }
      .music_card_title {
          font-size: 17px;
          font-weight: 700;
      }
      .music_card_desc {
        color: rgba(0,0,0,.5);
          font-weight: 400;
          font-size: 12px;
          padding-top: 8px;
          padding-right: 1.33333333em;
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
    // 音频原样输出
    turndownService.addRule('audio', {
      filter: function (node) {
        return node.nodeName == 'AUDIO';
      },
      replacement: function (_content, node: HTMLElement) {
        return node.outerHTML;
      }
    });
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
  public objToArticle(appMsgExtInfo, dateTime: Date, articleArr: ArticleInfo[]) {
    const title = appMsgExtInfo['title'];
    const contentUrl = appMsgExtInfo['content_url'];
    if (contentUrl) {
      const article: ArticleInfo = { title: title, datetime: dateTime, contentUrl: contentUrl };
      article.author = appMsgExtInfo['author'];
      article.copyrightStat = appMsgExtInfo['copyright_stat'];
      articleArr.push(article);
    }
  }
  /*
   * 将数据库的json对象转为ArticleInfo
   */
  public dbObjToArticle(dbObj): ArticleInfo {
    const article = new ArticleInfo(dbObj['title'], dbObj['create_time'], dbObj['content_url']);
    article.author = dbObj['author'];
    article.html = dbObj['content'];
    return article;
  }
}

export { GzhInfo, ArticleInfo, DownloadOption, NodeWorkerResponse, Service, NwrEnum, DlEventEnum };
