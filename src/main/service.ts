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
  public title: string;
  public datetime: Date;
  public contentUrl: string;

  constructor(title, datetime, contentUrl) {
    this.title = title;
    this.datetime = datetime;
    this.contentUrl = contentUrl;
  }
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
    const default_setting = {
      firstRun: false,
      // 下载为markdown
      dlMarkdown: 1,
      // 跳过现有文章
      skinExist: 1,
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
          margin: 0 20%;
        }
        h1,h2 {
          text-align: center;
        }
        .page img {
          max-width: 100%;
          margin: 0 auto;
          display: block;
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
}

export { GzhInfo, ArticleInfo, Service };
