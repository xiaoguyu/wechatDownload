import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

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
        console.log(`下载文件失败，url:${url}`, error);
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
  public static getStyleWidth(styleStr): string | null {
    const widthExpression = /width:\s*(\d+px)/g;
    const widthResultArr = widthExpression.exec(styleStr);
    if (widthResultArr && widthResultArr.length > 1) {
      return widthResultArr[1].replace('px', '');
    }
    return null;
  }

  /*
   * 将字符串转换成文件夹名字允许的格式
   */
  public static strToDirName(title: string): string {
    const cleanDirExpression = /[\\\\/:*?"<>|\\.\\s]/g;
    return title.replaceAll(cleanDirExpression, '');
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
}

export { HttpUtil, StrUtil, FileUtil };
