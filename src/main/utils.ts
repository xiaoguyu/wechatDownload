import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import logger from './logger';

class FileUtil {
  /*
   * 下载文件
   * url 是图片地址，如，http://wximg.233.com/attached/image/20160815/20160815162505_0878.png
   * filepath 是文件下载的本地目录
   * name 是下载后的文件名
   */
  public static async downloadFile(url: string, filepath: string, name: string): Promise<string> {
    const mypath = path.resolve(filepath, name);
    // 文件存在不覆盖
    if (fs.existsSync(mypath)) {
      // return new Promise((resolve) => {
      //   resolve(name);
      // });
      return name;
    }
    const writer = fs.createWriteStream(mypath);
    await axios
      .get(url, {
        responseType: 'stream'
      })
      .then((response) => {
        response.data.pipe(writer);
      })
      .catch((error) => {
        logger.error(`下载文件失败，url:${url}`, error);
      });

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(name));
      writer.on('error', (err) => reject(err));
    });
  }
}

class StrUtil {
  /*
   * 获取style中的宽度
   */
  static widthExpression = /width:\s*(\d+px)/g;
  public static getStyleWidth(styleStr): string | null {
    const widthResultArr = StrUtil.widthExpression.exec(styleStr);
    if (widthResultArr && widthResultArr.length > 1) {
      return widthResultArr[1].replace('px', '');
    }
    return null;
  }

  /*
   * 将字符串转换成文件夹名字允许的格式
   */
  static cleanDirExpression = /^\.*?|\n|\\n|[\\\\/:*?"<>|]|\.*?$/gim;
  public static strToDirName(title: string): string {
    const cleanTitle = title.replaceAll(StrUtil.cleanDirExpression, '');
    if (cleanTitle.length > 250) {
      return cleanTitle.substring(0, 250);
    }
    return cleanTitle;
  }

  /*
   * 去除两边空白字符
   */
  static trimExpression = /^\s*|\s*$/g;
  public static trim(str: string): string {
    return str.replaceAll(StrUtil.trimExpression, '');
  }
}

class HttpUtil {
  // 获取url参数
  public static getQueryVariable(url: string, variable: string): string | null {
    if (url.indexOf('?') == -1) {
      return null;
    }
    const query = url.split('?')[1];
    const vars = query.split('&');
    for (let i = 0; i < vars.length; i++) {
      const pair = vars[i].split('=');
      if (pair[0] == variable) {
        let result = '';
        for (let j = 1; j < pair.length; j++) {
          const pairItem = pair[j];
          if (pairItem == '') {
            result += '=';
          } else {
            result += pair[j];
          }
        }
        return result;
      }
    }
    return null;
  }

  // 从url中获取文件类型后缀
  // 例如 url = http://www.baidu.com/ddd.png?id=12.22
  public static getSuffByUrl(url: string): string | null {
    const questIdx = url.lastIndexOf('?');
    const dotIdx = url.lastIndexOf('.', questIdx > 0 ? questIdx : url.length);
    if (dotIdx <= 0) {
      return null;
    }
    const suff = url.substring(dotIdx + 1, questIdx > 0 ? questIdx : url.length);
    if (suff?.length > 5) {
      return null;
    }
    return suff;
  }
}

class DateUtil {
  public static format(datetime: Date | string, formatting: string): string {
    let timestamp: Date = datetime as Date;
    if (typeof datetime === 'string') {
      timestamp = new Date(Date.parse(datetime));
    }
    const fullYear: string = timestamp.getFullYear().toString();
    const monthNum = timestamp.getMonth() + 1;
    const month: string = monthNum.toString();
    const date: string = timestamp.getDate().toString();
    const hours: string = timestamp.getHours().toString();
    const minutes: string = timestamp.getMinutes().toString();
    const seconds: string = timestamp.getSeconds().toString();
    const milliseconds: string = timestamp.getMilliseconds().toString();
    formatting = this.parse(formatting, /[y|Y]+/, fullYear);
    formatting = this.parse(formatting, /[M]+/, month, '00');
    formatting = this.parse(formatting, /[d|D]+/, date, '00');
    formatting = this.parse(formatting, /[h|H]+/, hours, '0');
    formatting = this.parse(formatting, /[m]+/, minutes, '00');
    formatting = this.parse(formatting, /[s]+/, seconds, '00');
    formatting = this.parse(formatting, /[S]+/, milliseconds, '000');
    return formatting;
  }

  private static parse(formatting: string, pattern: RegExp, val: string, min?: string): string {
    while (pattern.test(formatting)) {
      pattern.exec(formatting)?.forEach((value) => {
        const length = value.length;
        const valLen = val.length;
        const number = valLen - length;
        let element = val.substring(number);
        if (min) {
          element = min.substring(element.length) + element;
        }
        formatting = formatting.replace(value, element);
      });
    }
    return formatting;
  }
}

export { HttpUtil, StrUtil, FileUtil, DateUtil };
