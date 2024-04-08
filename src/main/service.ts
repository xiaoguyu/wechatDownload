import { StrUtil } from './utils';

import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

// 获取公号文章列表需要的信息
class GzhInfo {
  public biz: string;
  public key: string;
  public uin: string;
  public passTicket?: string | null;
  public Host?: string | null;
  public Cookie?: string | null;
  public UserAgent?: string | null;

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
  // 摘要
  public digest?: string;
  // 保存文件名（因为有些标题不一定符合文件名的格式）
  public fileName?: string;
  // 时间
  public datetime?: Date;
  // 详情url
  public contentUrl: string;
  // html源码
  public html?: string;
  // 封面
  public cover?: string;
  // 作者
  public author?: string;
  // 元数据
  public metaInfo?: ArticleMeta;
  // 评论列表数据
  public commentList?: [];
  // 评论详细数据
  public replyDetailMap?: Map<unknown, unknown>;
  public copyrightStat?: number;
  public gzhInfo?: GzhInfo;

  constructor(title, datetime, contentUrl) {
    this.title = title;
    this.datetime = datetime;
    this.contentUrl = contentUrl;
  }
}
// 文章元数据类
class ArticleMeta {
  // 原创标识
  public copyrightFlg?: boolean;
  // 作者
  public author?: string;
  // 公号名
  public jsName?: string;
  // 发布时间
  public publicTime?: string;
  // ip位置
  public ipWording?: string;
}
// 配置类
class DownloadOption {
  // 首次运行
  public firstRun?: boolean;
  // 下载来源
  public dlSource?: string;
  // 线程类型
  public threadType?: string;
  // 下载间隔
  public dlInterval?: number;
  // 单批数量
  public batchLimit?: number;
  // 下载为html
  public dlHtml?: number;
  // 下载为markdown
  public dlMarkdown?: number;
  // 下载为pdf
  public dlPdf?: number;
  // 保存至mysql
  public dlMysql?: number;
  // 下载音频到本地
  public dlAudio?: number;
  // 下载图片到本地
  public dlImg?: number;
  // 跳过现有文章
  public skinExist?: number;
  // 是否保存元数据
  public saveMeta?: number;
  // 是否按公号名字归类
  public classifyDir?: number;
  // 是否添加原文链接
  public sourceUrl?: number;
  // 是否下载评论
  public dlComment?: number;
  // 是否下载回复
  public dlCommentReply?: number;
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
  // 是否清洗markdown，并保存数据库
  public cleanMarkdown?: number;
  // 过滤规则
  public filterRule?: string;
}
class FilterRuleInfo {
  // 标题包含
  public titleInclude: string[] = [];
  // 标题不包含
  public titleExclude: string[] = [];
  // 作者包含
  public authInclude: string[] = [];
  // 作者不包含
  public authExclude: string[] = [];
}
// nodeWorker交互使用的通用消息响应类
class NodeWorkerResponse {
  public code: NwrEnum;
  public message: string;
  public data?: any;
  constructor(code: NwrEnum, message: string, data?) {
    this.code = code;
    this.message = message;
    this.data = data;
  }
}
// PDF信息类
class PdfInfo {
  public id: string;
  // 标题
  public title: string;
  // 保存文件名（因为有些标题不一定符合文件名的格式）
  public fileName?: string;
  // 保存路径
  public savePath: string;

  constructor(id: string, title: string, savePath: string, fileName?: string) {
    this.id = id;
    this.title = title;
    this.fileName = fileName;
    this.savePath = savePath;
  }
}
// NodeWorkerResponse的code枚举类
enum NwrEnum {
  START, // 启动
  SUCCESS, // 成功，输出日志
  FAIL, // 失败，输出日志并失败处理
  ONE_FINISH, // 单个下载结束，输出日志并做结束处理
  BATCH_FINISH, // 多个下载结束，输出日志并做结束处理
  CLOSE, // 结束线程
  PDF, // 创建pdf
  PDF_FINISHED // 创建pdf完成
}
// 下载事件枚举类
enum DlEventEnum {
  ONE, // 下载单篇文章
  BATCH_WEB, // 微信接口批量下载
  BATCH_DB, // 数据库批量下载
  BATCH_SELECT // 批量选择下载
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
          startDate.setHours(0, 0, 0, 0);
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
  public prepHtml(html: string): any {
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
    return $;
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
      .foot {
        background-color: #ededed;
        padding: 8px;
        display: none
      }
      .comment {
        max-width: 677px;
        margin-left: auto;
        margin-right: auto;
      }
      .comment .desc {
        margin-bottom: 10px;
      }
      .comment-item {
        display: flex;
        margin-bottom: 20px;
      }
      .comment-item img {
        width: 30px;
        margin-right: 8px;
      }
      .comment-item .nick-name {
        color: #695e5ee3;
        margin-right: 8px;
        font-size: 14px;
      }
      .comment-item .native-place {
        color: #9e9e9ed1;
        font-size: 14px;
      }
      .comment-item .content {
        padding-top: 5px;
        white-space: pre-line;
      }
      .comment-item .more-reply {
        margin-top: 10px;
        color: #9e9e9ed1;
      }
      .comment-item .reply {
        display: flex;
        margin-top: 10px;
      }
      .comment-item .reply img {
        width: 20px;
        margin-right: 8px;
      }
      .dialog {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background-color: rgba(0, 0, 0, 0.4);
      }
      .dialog .dcontent {
        width: 600px;
        height: 90%;
        margin: 2% auto auto auto;
        background-color: #fefefe;
        border-radius: 5px;
        position: relative;
        overflow: hidden;
        padding-top: 35px;
      }
      .dialog .aclose {
        text-align: left;
        line-height: 25px;
        padding: 5px 10px 0px 10px;
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        background-color: #ffffff;
      }
      .dialog .aclose span {
        font-size: 14px;
        color: #9e9e9ed1;
      }
      .dialog .close {
        color: #898686;
        float: right;
        font-size: 30px;
        text-decoration: none;
      }
      .dialog .contain {
        height: 100%;
        overflow: auto;
        display: flex;
        flex-flow: column;
        border-radius: 5px;
      }
      .dialog .d-top {
        padding: 0 20px;
      }
      .dialog .all-deply {
        background-color: #f7f7f7;
        padding: 10px 20px 0 20px;
        height: 100%;
      }
      .dialog .all-deply .a-desc {
        color: #898686;
        margin-bottom: 10px;
      }
      .reply-nick {
        color: #898686;
        margin: 0 3px;
      }
      .meta-div {
        margin-bottom: 10px;
        color: #898686;
      }
      .meta-div span {
        margin-right: 10px;
      }
      .meta-div .copyright-span {
        background-color: #0000000d;
        font-size: 14px;
        padding: 2px;
      }
      </style>
    `;
  }
  /*
   * 处理评论的js
   */
  public getHtmlComment(commentList, replyDetailMap, showAllComment = false): string {
    return `
    <script type="text/javascript">
      const electedCommentArr = ${JSON.stringify(commentList)}
      const electedCommentDetailMap = ${JSON.stringify(replyDetailMap)}

      window.onload = function () {
        var innerStr = \`<div class="comment">
          <div class="desc">精选留言</div>\`
        
        for (const electedComment of electedCommentArr) {
          var contentId = electedComment['content_id']
          var logoUrl = electedComment['logo_url']
          var nickName = electedComment['nick_name']
          var provinceName = getPlaceName(electedComment)
          var content = electedComment['content']

          var replyList = electedComment['reply_new']['reply_list']
          var replyList = ${showAllComment ? "electedCommentDetailMap[contentId] || electedComment['reply_new']['reply_list']" : "electedComment['reply_new']['reply_list']"}
          var replyTotalCnt = electedComment['reply_new']['reply_total_cnt']

          var moreStr = ""
          if (replyTotalCnt > replyList.length) {
            moreStr = \`<div class="more-reply" onclick="showDetail('\${contentId}')">
                \${replyTotalCnt}条回复&gt;
              </div>\`
          }

          var replyStr = ''
          for (const replyItem of replyList) {
            var replyLogoUrl = replyItem['logo_url']
            var replyNickName = replyItem['nick_name']
            if (replyItem['is_from'] == 2) {
              replyNickName += '(作者)'
            }
            let replyToNickName = replyItem['to_nick_name']
            let toNickNameStr = replyToNickName ? \`回复<span class="reply-nick">\${replyToNickName}</span>：\` : ''
            var replyProvinceName = getPlaceName(replyItem)
            var replyContent = replyItem['content']
            replyStr += \`<div class="reply">
                <div>
                  <img src="\${replyLogoUrl}">
                </div>
                <div class="right-div">
                  <span class="nick-name">\${replyNickName}</span><span class="native-place">\${replyProvinceName ? "来自" + replyProvinceName : ""}</span>
                  <div class="content">\${toNickNameStr + replyContent}</div>
                </div>
              </div>\`
          }
          
          var itemStr = \`<div class="comment-item">
            <div>
              <img src="\${logoUrl}">
            </div>
            <div class="right-div">
              <span class="nick-name">\${nickName}</span><span class="native-place">\${provinceName ? "来自" + provinceName : ""}</span>
              <div class="content">\${content}</div>
              \${moreStr}
              \${replyStr}
            </div>
          </div>\`

          innerStr += itemStr
        }
        

        innerStr += \`</div></div>\`
        var footEle = document.querySelector(".foot");
        footEle.innerHTML = innerStr
        footEle.style.display = 'block'

      }

      function showDetail(contentId) {
        let selectedComment;
        for (const electedComment of electedCommentArr) {
          if (electedComment['content_id'] == contentId) {
            selectedComment = electedComment;
            break;
          }
        }
        let logoUrl = selectedComment['logo_url']
        let nickName = selectedComment['nick_name']
        let provinceName = getPlaceName(selectedComment)
        let content = selectedComment['content']
        document.querySelector(".dialog .d-top").innerHTML = \`<div class="comment-item">
                <div>
                  <img src="\${logoUrl}">
                </div>
                <div class="right-div">
                  <span class="nick-name">\${nickName}</span><span class="native-place">\${provinceName ? "来自" + provinceName : ""}</span>
                  <div class="content">\${content}</div>
                </div>
              </div>\`
    
        let replyArr = electedCommentDetailMap[contentId]
        replyArr = replyArr ? replyArr : selectedComment['reply_new']['reply_list']
        let applyHtml = '<div class="a-desc">全部回复</div>'
        if (replyArr && replyArr.length > 0) {
          for (const replyItem of replyArr) {
            let replyLogoUrl = replyItem['logo_url']
            let replyNickName = replyItem['nick_name']
            let replyProvinceName = getPlaceName(replyItem)
            let replyContent = replyItem['content']
            let replyToNickName = replyItem['to_nick_name']
            let toNickNameStr = replyToNickName ? \`回复<span class="reply-nick">\${replyToNickName}</span>：\` : ''
            applyHtml += \`<div class="comment-item">
                <div>
                  <img
                    src="\${replyLogoUrl}">
                </div>
                <div class="right-div">
                  <span class="nick-name">\${replyNickName}</span><span class="native-place">\${replyProvinceName ? "来自" + replyProvinceName : ""}</span>
                  <div class="content">\${toNickNameStr + replyContent}</div>
                </div>
              </div>\`
          }
        }
        document.querySelector(".dialog .all-deply").innerHTML = applyHtml
    
        let dialogEle = document.querySelector('.dialog');
        dialogEle.style.display = 'block'
      }

      function showDialog() {
        let dialogEle = document.querySelector('.dialog');
        dialogEle.style.display = 'block'
      }
      function closeDialog() {
        let dialogEle = document.querySelector('.dialog');
        dialogEle.style.display = 'none'
      }
      function getPlaceName(electedComment) {
        let placeName = '';
        if (electedComment['ip_wording']) {
          placeName = electedComment['ip_wording']['province_name'] ? electedComment['ip_wording']['province_name'] : electedComment['ip_wording']['country_name'];
        }
        return placeName;
      }
    </script>
    `;
  }
  /**
   * 获取元数据渲染的html
   * @param articleMeta 文章元数据
   * @returns 元数据渲染的html
   */
  public getMetaHtml(articleMeta?: ArticleMeta): string {
    if (!articleMeta) {
      return '';
    }
    let htmlStr = '<div class="meta-div">';
    htmlStr += `<span class="copyright-span">${articleMeta.copyrightFlg ? '原创' : '非原创'} </span>`;
    if (articleMeta.author) {
      htmlStr += `<span>作者:${articleMeta.author} </span>`;
    }
    if (articleMeta.jsName) {
      htmlStr += `<span>公号:${articleMeta.jsName} </span>`;
    }
    if (articleMeta.publicTime) {
      htmlStr += `<span>发布时间:${articleMeta.publicTime} </span>`;
    }
    if (articleMeta.ipWording) {
      htmlStr += `<span>发表于${articleMeta.ipWording} </span>`;
    }
    htmlStr += '</div>';
    return htmlStr;
  }
  /*
   * markdown格式的评论内容
   */
  public getMarkdownComment(commentList, replyDetailMap): string {
    let markdownStr = '';
    if (commentList) {
      markdownStr += '\n\n---\n\n精选留言\n\n';
      for (const electedComment of commentList) {
        const contentId = electedComment['content_id'];
        const nickName = electedComment['nick_name'];
        let provinceName = this.getPlaceName(electedComment);
        provinceName = provinceName ? '（来自' + provinceName + '）' : '';
        const content: string = electedComment['content'];
        markdownStr += `\n- **${nickName}**${provinceName}\n  ${content.replaceAll('\n', '\n  ')}\n`;
        let replyList = replyDetailMap ? replyDetailMap[contentId] : null;
        if (!replyList) {
          replyList = electedComment['reply_new']['reply_list'];
        }
        if (!replyList) {
          continue;
        }
        for (const replyItem of replyList as []) {
          let replyNickName: string = replyItem['nick_name'];
          if (replyItem['is_from'] == 2) {
            replyNickName += '(作者)';
          }
          let replyProvinceName = this.getPlaceName(electedComment);
          replyProvinceName = replyProvinceName ? '（来自' + replyProvinceName + '）' : '';
          const replyContent: string = replyItem['content'];
          const replyToNickName = replyItem['to_nick_name'];
          const toNickNameStr = replyToNickName ? `回复 ${replyToNickName} ：` : '';
          markdownStr += `\n  - **${replyNickName}**${replyProvinceName}\n    ${toNickNameStr + replyContent.replaceAll('\n', '\n    ')}\n`;
        }
      }
    }
    return markdownStr;
  }
  private getPlaceName(electedComment): string {
    let placeName = '';
    if (electedComment['ip_wording']) {
      placeName = electedComment['ip_wording']['province_name'] ? electedComment['ip_wording']['province_name'] : electedComment['ip_wording']['country_name'];
    }
    return placeName;
  }
  /*
   * 创建html转markdown的TurndownService
   */
  public createTurndownService() {
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
  public getTmpHtml(html: string): string {
    const $ = cheerio.load(html);
    this.replaceSrc($, $('img[tmpsrc]'));
    this.replaceSrc($, $('source[tmpsrc]'));

    return $.html();
  }

  private replaceSrc($, eleArr) {
    for (const elem of eleArr) {
      const $ele = $(elem);
      const tmpsrc = $ele.attr('tmpsrc');
      if (tmpsrc && tmpsrc.length > 0) {
        $ele.attr('src', tmpsrc);
      }
    }
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
      article.digest = appMsgExtInfo['digest'];
      article.cover = appMsgExtInfo['cover'];
      articleArr.push(article);
    }
  }
  /*
   * 将数据库的json对象转为ArticleInfo
   */
  public dbObjToArticle(dbObj, downloadOption: DownloadOption): ArticleInfo {
    const article = new ArticleInfo(dbObj['title'], dbObj['create_time'], dbObj['content_url']);
    article.author = dbObj['author'];
    article.html = dbObj['content'];
    article.digest = dbObj['digest'];
    article.cover = dbObj['cover'];
    if (1 == downloadOption.dlComment) article.commentList = JSON.parse(dbObj['comm']);
    if (1 == downloadOption.dlCommentReply) article.replyDetailMap = JSON.parse(dbObj['comm_reply']);
    return article;
  }
  /*
   * 获取html源码中的comment_id
   */
  commentIdRegex = /var comment_id = "(.*)" \|\| "(.*)" \* 1;/;
  postCommentIdRegex = /getXmlValue\('comment_id\.DATA'\)\s?:\s?'(\d*)';/;
  public matchCommentId(html: string): string {
    let match = this.commentIdRegex.exec(html);
    if (match) {
      return match[1];
    }
    match = this.postCommentIdRegex.exec(html);
    if (match) {
      return match[1];
    }
    return '';
  }
  /*
   * 获取html源码中的时间戳
   */
  // 匹配var create_time = "1699399873" * 1;
  createTimeRegex = /var create_time = "(\d*)" \* 1;/;
  // 匹配window.ct = '1695861587',
  postCreateTimeRegex = /window.ct\s?=\s?'(\d*)'/;
  public matchCreateTime(html: string): Date | undefined {
    let match = this.createTimeRegex.exec(html);
    if (match) {
      return new Date(Number(match[1]) * 1000);
    }
    match = this.postCreateTimeRegex.exec(html);
    if (match) {
      return new Date(Number(match[1]) * 1000);
    }
    return undefined;
  }
  /**
   * 获取html源码中的发布地址
   */
  ipWordingRegex = /provinceName: '([\u4e00-\u9fa5]*)'/;
  public matchIpWording(html: string): string | undefined {
    const match = this.ipWordingRegex.exec(html);
    if (match) {
      return match[1];
    }
    return undefined;
  }
}

export { GzhInfo, ArticleInfo, ArticleMeta, PdfInfo, DownloadOption, FilterRuleInfo, NodeWorkerResponse, Service, NwrEnum, DlEventEnum };
