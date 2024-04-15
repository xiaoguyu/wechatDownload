import { parentPort, workerData } from 'worker_threads';
import logger from './logger';
import { StrUtil, FileUtil, DateUtil, HttpUtil } from './utils';
import { GzhInfo, ArticleInfo, ArticleMeta, PdfInfo, DownloadOption, FilterRuleInfo, Service, NodeWorkerResponse, NwrEnum, DlEventEnum } from './service';
import axios from 'axios';
import md5 from 'blueimp-md5';
import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2';
import * as Readability from '@mozilla/readability';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import axiosRetry from 'axios-retry';

const onRetry = (retryCount, _err, requestConfig) => {
  logger.info(`第${retryCount}次请求失败`, requestConfig.url, requestConfig.params);
};
axiosRetry(axios, { retries: 3, onRetry });

const service = new Service();
// html转markdown的TurndownService
const turndownService = service.createTurndownService();
// 下载数量限制
// 获取文章列表时，数量查过此限制不再继续获取列表，而是采集详情页后再继续获取列表
const DOWNLOAD_LIMIT = workerData.downloadOption.batchLimit ?? 10;
// 获取文章列表的url
const LIST_URL = 'https://mp.weixin.qq.com/mp/profile_ext?action=getmsg&f=json&count=10&is_ok=1';
const COMMENT_LIST_URL = 'https://mp.weixin.qq.com/mp/appmsg_comment?action=getcomment&offset=0&limit=100&f=json';
const COMMENT_REPLY_URL = 'https://mp.weixin.qq.com/mp/appmsg_comment?action=getcommentreply&offset=0&limit=100&is_first=1&f=json';
const QQ_MUSIC_INFO_URL = 'https://mp.weixin.qq.com/mp/qqmusic?action=get_song_info';
// 插入数据库的sql
const TABLE_NAME = workerData.tableName;
// const INSERT_SQL = `INSERT INTO ${TABLE_NAME} ( title, content, author, content_url, create_time, copyright_stat, comm, comm_reply) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title = ? , create_time=?`;
const INSERT_SQL = `INSERT INTO ${TABLE_NAME} ( title, content, author, content_url, create_time, copyright_stat, comm, comm_reply, digest, cover, js_name, md_content) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title = ? , create_time=?`;
const SELECT_SQL = `SELECT title, content, author, content_url, create_time, comm, comm_reply FROM ${TABLE_NAME} WHERE create_time >= ? AND create_time <= ?`;

// 数据库连接配置
const connectionConfig: mysql.ConnectionConfig = workerData.connectionConfig;
// 设置中心的配置
const downloadOption: DownloadOption = workerData.downloadOption;
// 下载事件（单个下载还是批量）
const dlEvent: DlEventEnum = workerData.dlEvent;
// 存储公众号信息的对象
let GZH_INFO: GzhInfo;
// 数据库连接
let CONNECTION: mysql.Connection;
let CONNECTION_STATE = false;
// 存放保存pdf任务钩子的map
const PDF_RESOLVE_MAP = new Map();
// 失败次数map
const FAIL_COUNT_MAP = new Map();
// 触发公众号反爬机制时重试等待时间(单位秒)
// 别问为什么是60秒，因为30秒不够
const FAIL_WAIT_SECOND = 60;
// 触发公众号反爬机制时重试次数
const FAIL_RETRY = 1;

// 阻塞线程的sleep函数
function sleep(delay?: number): Promise<void> {
  return new Promise((resolve) => {
    if (delay && delay > 0) {
      setTimeout(resolve, delay);
    } else {
      resolve();
    }
  });
}

const port = parentPort;
if (!port) throw new Error('IllegalState');

// 接收消息，执行任务
port.on('message', async (message: NodeWorkerResponse) => {
  if (message.code == NwrEnum.START) {
    // 初始化数据库连接
    await createMysqlConnection();

    // 下载单个文章
    if (dlEvent == DlEventEnum.ONE) {
      const url = workerData.data;
      const articleInfo = new ArticleInfo(null, null, url);
      await axiosDlOne(articleInfo);
      resp(NwrEnum.ONE_FINISH, '');
      finish();
    } else if (dlEvent == DlEventEnum.BATCH_WEB) {
      // 从微信接口批量下载
      GZH_INFO = workerData.data;
      await batchDownloadFromWeb();
    } else if (dlEvent == DlEventEnum.BATCH_DB) {
      // 从数据库批量下载
      await batchDownloadFromDb();
    } else if (dlEvent == DlEventEnum.BATCH_SELECT) {
      await batchDownloadFromWebSelect(workerData.data);
    }
  } else if (message.code == NwrEnum.PDF_FINISHED) {
    // pdf保存完成的回调
    const pdfKey = message.data || '';
    const resolve = PDF_RESOLVE_MAP.get(pdfKey);
    if (resolve) {
      resolve();
      PDF_RESOLVE_MAP.delete(pdfKey);
    }
  }
});

port.on('close', () => {
  logger.info('on 线程关闭');
});

port.addListener('close', () => {
  logger.info('addListener 线程关闭');
});

/**
 * 下载文章
 * @param articleInfo 文章信息
 * @param recall 是否重试
 */
async function axiosDlOne(articleInfo: ArticleInfo, reCall = false) {
  // 如果标题不为空，则是从批量下载过来的，可以提前判断跳过
  if (articleInfo.title && !reCall) {
    const timeStr = articleInfo.datetime ? DateUtil.format(articleInfo.datetime, 'yyyy-MM-dd') + '-' : '';
    const saveDirName = StrUtil.strToDirName(articleInfo.title);
    articleInfo.fileName = saveDirName;
    // 创建保存文件夹
    const savePath = path.join(downloadOption.savePath || '', timeStr + saveDirName);
    if (fs.existsSync(savePath) && downloadOption.skinExist && downloadOption.skinExist == 1) {
      resp(NwrEnum.SUCCESS, `【${saveDirName}】已存在，跳过此文章`);
      return;
    }
  }

  const gzhInfo = articleInfo.gzhInfo;
  await axios
    .get(articleInfo.contentUrl, {
      params: {
        key: gzhInfo ? gzhInfo.key : '',
        uin: gzhInfo ? gzhInfo.uin : ''
      }
    })
    .then((response) => {
      if (response.status != 200) {
        logger.error(`获取页面数据失败，状态码：${response.status}, URL:${articleInfo.contentUrl}`);
        resp(NwrEnum.FAIL, `下载失败，状态码：${response.status}, URL:${articleInfo.contentUrl}`);
        return;
      }
      articleInfo.html = response.data;
    })
    .catch((error) => {
      logger.error('获取页面数据失败', error);
    });
  if (!articleInfo.html) return;
  await dlOne(articleInfo, true);
}

/*
 * 下载单个页面
 */
async function dlOne(articleInfo: ArticleInfo, saveToDb = true) {
  // 预处理微信公号文章html
  if (!articleInfo.html) return;
  const url = articleInfo.contentUrl;
  const $source = service.prepHtml(articleInfo.html);
  // 提取正文
  /*
   * 总共有3种格式：
   * 1.普通格式
   * 2.海报格式：https://mp.weixin.qq.com/s/00XdizbDQtKRWxFv6iGqIA
   * 3.纯文字格式：https://mp.weixin.qq.com/s/vLuVL5owS5VdTDmMRzu3vQ
   */
  let _article;
  if ($source('#js_article').hasClass('share_content_page')) {
    _article = parsePostHtml(articleInfo, $source);
  } else if ($source('#js_article').hasClass('page_content')) {
    _article = parseShortTextHtml(articleInfo, $source);
  } else {
    const doc = new JSDOM($source.html());
    const reader = new Readability.Readability(<Document>doc.window.document, { keepClasses: true });
    // #issues/45 因为文章会出现 selection或者p标签包含着mpvoice，但是里面又没有文字，会被Readability自动删除，需要修改源码
    // 修改Readability的源码(不推荐这种做法)
    (reader as any)._isElementWithoutContent = function (node) {
      return node.getElementsByTagName('mpvoice').length == 0 && node.nodeType === 1 && node.textContent.trim().length == 0 && (node.children.length == 0 || node.children.length == node.getElementsByTagName('br').length + node.getElementsByTagName('hr').length);
    };
    (reader as any)._removeNodes = function (nodeList, filterFn) {
      // Avoid ever operating on live node lists.
      if (this._docJSDOMParser && nodeList._isLiveNodeList) {
        throw new Error('Do not pass live node lists to _removeNodes');
      }
      for (let i = nodeList.length - 1; i >= 0; i--) {
        const node = nodeList[i];
        const parentNode = node.parentNode;
        if (parentNode) {
          const mpvoiceCount = parentNode.getElementsByTagName('mpvoice').length;
          if (!filterFn || (filterFn.call(this, node, i, nodeList) && mpvoiceCount.length == 0)) {
            parentNode.removeChild(node);
          }
        }
      }
    };
    _article = reader.parse();
  }
  if (!_article) {
    resp(NwrEnum.FAIL, '提取正文失败');
    return;
  }
  const article = _article;

  // 触发了公众号的反爬机制，进行重试
  if (article.title == '验证') {
    let failCount = FAIL_COUNT_MAP.get(articleInfo.contentUrl) || 0;
    failCount++;
    if (failCount > FAIL_RETRY) {
      resp(NwrEnum.FAIL, `触发公众号的反爬机制，停止采集!`);
      resp(NwrEnum.FAIL, `建议设置合理的下载间隔`);
      resp(NwrEnum.FAIL, `建议选择合适的下载范围，按区间分批下载`);
      resp(NwrEnum.BATCH_FINISH, '');
      finish();
    }
    FAIL_COUNT_MAP.set(articleInfo.contentUrl, failCount);
    resp(NwrEnum.FAIL, `【${articleInfo.title}】触发公众号的反爬机制，等待${FAIL_WAIT_SECOND}秒后进行重试!`);
    await sleep(FAIL_WAIT_SECOND * 1000);
    resp(NwrEnum.FAIL, `【${articleInfo.title}】进行第${failCount}次重试`);
    await axiosDlOne(articleInfo, true);
    return;
  }

  if (!articleInfo.title) articleInfo.title = article.title;
  if (!articleInfo.author) articleInfo.author = article.byline;
  if (!articleInfo.datetime) articleInfo.datetime = service.matchCreateTime($source.html());

  // 提取元数据
  parseMeta(articleInfo, $source, article.byline);

  // 过滤规则
  const { flgFilter, filterMsg } = doFilter(articleInfo);
  if (flgFilter) {
    resp(NwrEnum.SUCCESS, `【${article.title}】已过滤：${filterMsg}`);
    return;
  }

  // 下载评论
  await downloadComment(articleInfo);

  // 创建保存文件夹
  const timeStr = articleInfo.datetime ? DateUtil.format(articleInfo.datetime, 'yyyy-MM-dd') + '-' : '';
  const saveDirName = StrUtil.strToDirName(articleInfo.title || '');
  const jsName = 1 == downloadOption.classifyDir ? StrUtil.strToDirName(articleInfo.metaInfo?.jsName || '') : '';
  articleInfo.fileName = saveDirName;
  const savePath = path.join(downloadOption.savePath || '', jsName, timeStr + saveDirName);
  if (!fs.existsSync(savePath)) {
    try {
      fs.mkdirSync(savePath, { recursive: true });
    } catch (err) {
      resp(NwrEnum.FAIL, `【${saveDirName}】创建失败，跳过此文章`);
      return;
    }
  } else {
    // 跳过已有文章
    if (downloadOption.skinExist && downloadOption.skinExist == 1) {
      resp(NwrEnum.SUCCESS, `【${saveDirName}】已存在，跳过此文章`);
      return;
    }
  }
  // 创建缓存文件夹
  const tmpPath = path.join(downloadOption.tmpPath || '', md5(url));
  if (!fs.existsSync(tmpPath)) {
    fs.mkdirSync(tmpPath, { recursive: true });
  }

  // 判断是否需要下载图片
  let imgCount = 0;
  const $ = cheerio.load(article.content);

  if (1 == downloadOption.dlImg) {
    await downloadImgToHtml($, savePath, tmpPath, articleInfo).then((obj) => {
      imgCount = obj.imgCount;
    });
  }

  // 处理音频
  await convertAudio($, savePath, tmpPath, articleInfo);

  const readabilityPage = $('#readability-page-1');
  // 插入原文链接
  if (1 == downloadOption.sourceUrl) {
    readabilityPage.prepend(`<div>原文地址：<a href='${url}' target='_blank'>${article.title}</a></div>`);
  }
  // 插入元数据
  if (1 == downloadOption.saveMeta) {
    readabilityPage.prepend(service.getMetaHtml(articleInfo.metaInfo));
  }
  // 插入标题
  readabilityPage.prepend(`<h1>${article.title}</h1>`);

  const proArr: Promise<void>[] = [];

  // 判断是否保存markdown
  if (1 == downloadOption.dlMarkdown) {
    proArr.push(
      new Promise((resolve) => {
        const markdownStr = turndownService.turndown($.html());
        // 添加评论
        const commentStr = service.getMarkdownComment(articleInfo.commentList, articleInfo.replyDetailMap);
        fs.writeFile(path.join(savePath, `${articleInfo.fileName}.md`), markdownStr + commentStr, () => {
          resp(NwrEnum.SUCCESS, `【${article.title}】保存Markdown完成`);
          resolve();
        });
      })
    );
  }
  // 判断是否保存html
  if (1 == downloadOption.dlHtml) {
    proArr.push(
      new Promise((resolve) => {
        const $html = cheerio.load($.html());
        // 添加样式美化
        const headEle = $html('head');
        headEle.append(service.getArticleCss());
        // 添加评论数据
        if (articleInfo.commentList) {
          headEle.after(service.getHtmlComment(articleInfo.commentList, articleInfo.replyDetailMap));
        }
        const htmlReadabilityPage = $html('#readability-page-1');
        // 评论的div块
        htmlReadabilityPage.after('<div class="foot"></div><div class="dialog"><div class="dcontent"><div class="aclose"><span>留言</span><a class="close"href="javascript:closeDialog();">&times;</a></div><div class="contain"><div class="d-top"></div><div class="all-deply"></div></div></div></div>');
        fs.writeFile(path.join(savePath, `${articleInfo.fileName}.html`), $html.html(), () => {
          resp(NwrEnum.SUCCESS, `【${article.title}】保存HTML完成`);
          resolve();
        });
      })
    );
  }
  // 判断是否保存pdf
  if (1 == downloadOption.dlPdf) {
    proArr.push(
      new Promise((resolve) => {
        const $pdf = cheerio.load($.html());
        // 添加样式美化
        const headEle = $pdf('head');
        headEle.append(service.getArticleCss());
        // 添加评论数据
        if (articleInfo.commentList) {
          headEle.after(service.getHtmlComment(articleInfo.commentList, articleInfo.replyDetailMap, true));
        }
        const htmlReadabilityPage = $pdf('#readability-page-1');
        // 评论的div块
        htmlReadabilityPage.after('<div class="foot"></div><div class="dialog"><div class="dcontent"><div class="aclose"><span>留言</span><a class="close"href="javascript:closeDialog();">&times;</a></div><div class="contain"><div class="d-top"></div><div class="all-deply"></div></div></div></div>');
        fs.writeFile(path.join(savePath, 'pdf.html'), $pdf.html(), () => {
          resp(NwrEnum.SUCCESS, `【${article.title}】保存pdf的html文件完成`);
          const articleId = md5(articleInfo.contentUrl);
          // 通知main线程，保存pdf
          resp(NwrEnum.PDF, '保存pdf', new PdfInfo(articleId, article.title, savePath, articleInfo.fileName));
          // 保存回调钩子，等待main线程保存pdf完成
          PDF_RESOLVE_MAP.set(articleId, resolve);
        });
      })
    );
  }

  // 判断是否保存到数据库
  if (1 == downloadOption.dlMysql && CONNECTION_STATE && saveToDb) {
    proArr.push(
      new Promise((resolve) => {
        // 是否要清洗markdown并保存数据库（这是个人需求）
        let markdownStr: string = '';
        if (1 == downloadOption.cleanMarkdown) {
          const cleanHtml = service.getTmpHtml($.html());

          markdownStr = turndownService.turndown(cleanHtml);
        }

        const modSqlParams = [articleInfo.title, articleInfo.html, articleInfo.author, articleInfo.contentUrl, articleInfo.datetime, articleInfo.copyrightStat, JSON.stringify(articleInfo.commentList), JSON.stringify(articleInfo.replyDetailMap), articleInfo.digest, articleInfo.cover, articleInfo.metaInfo?.jsName, markdownStr, articleInfo.title, articleInfo.datetime];
        CONNECTION.query(INSERT_SQL, modSqlParams, function (err) {
          if (err) {
            logger.error('mysql插入失败', err);
          } else {
            resp(NwrEnum.SUCCESS, `【${article.title}】保存Mysql完成`);
          }
          resolve();
        });
      })
    );
  }

  for (const pro of proArr) {
    await pro;
  }
  resp(NwrEnum.SUCCESS, `【${article.title}】下载完成，共${imgCount}张图，url：${url}`);
}

const picListRegex = /window.picture_page_info_list\s*=\s(\[[\s\S]*\])\.slice/;
const cdnUrlRegex = /cdn_url:\s?'(.*)',/g;
// 解析海报格式页面：https://mp.weixin.qq.com/s/00XdizbDQtKRWxFv6iGqIA  https://mp.weixin.qq.com/s/fzPkvEyECe-MYE_OTHLS-w
function parsePostHtml(articleInfo: ArticleInfo, $) {
  // const $ = cheerio.load(articleInfo.html);
  // 获取内容
  const contentText = $('meta[name=description]').attr('content');
  // 获取图片
  const picArr: unknown[] = [];
  const picListmatch = picListRegex.exec(articleInfo.html || '');
  if (picListmatch) {
    let cdnUrlMatch;
    for (let iii = 0; iii < 20; iii++) {
      cdnUrlMatch = cdnUrlRegex.exec(picListmatch[1]);
      if (!cdnUrlMatch) {
        break;
      }
      picArr.push(cdnUrlMatch[1]);
    }
  }
  // 标题
  let title = $('.rich_media_title').text();
  if (!title) {
    title = contentText;
  }
  if (!title || picArr.length == 0) {
    return null;
  }
  let contentHtml = `<div id="readability-page-1" class="page"><p>${contentText.replaceAll(/\\x0a|\\n/g, '</br>')}</p>`;
  for (const pidx in picArr) {
    contentHtml = contentHtml + `<p><img src='${picArr[pidx]}' data-src='${picArr[pidx]}' ></p>`;
  }
  contentHtml += '</div>';
  // 获取作者
  const nickNameEle = $('.wx_follow_nickname');
  let byline;
  if (nickNameEle.length > 1) {
    byline = nickNameEle.first().text();
  } else {
    byline = nickNameEle.text();
  }

  return {
    title: title.replaceAll(/\\x0a|\\n/g, ''),
    content: contentHtml,
    textContent: '',
    length: 0,
    excerpt: '',
    byline: byline,
    dir: '',
    siteName: '',
    lang: ''
  };
}

// 解析短文字格式页面：https://mp.weixin.qq.com/s/vLuVL5owS5VdTDmMRzu3vQ
// 这种格式没有内容，只有标题
const shortTitleRegex = /window.msg_title\s?=\s?'(.*?)'/;
function parseShortTextHtml(articleInfo: ArticleInfo, $) {
  const shortTitleMatch = shortTitleRegex.exec(articleInfo.html || '');
  let title;
  if (shortTitleMatch) {
    title = shortTitleMatch[1];
  } else {
    return null;
  }

  // 获取内容
  let contentText = $('meta[name=description]').attr('content');
  if (!contentText) {
    contentText = title;
  }
  let contentHtml = `<div id="readability-page-1" class="page"><p>${contentText.replaceAll(/\\x0a|\\n/g, '</br>')}</p>`;
  // 获取作者
  const nickNameEle = $('.wx_follow_nickname');
  let byline;
  if (nickNameEle.length > 1) {
    byline = nickNameEle.first().text();
  } else {
    byline = nickNameEle.text();
  }

  contentHtml += '</div>';
  return {
    title: title.replaceAll(/\\x0a|\\n/g, ''),
    content: contentHtml,
    textContent: '',
    length: 0,
    excerpt: '',
    byline: byline,
    dir: '',
    siteName: '',
    lang: ''
  };
}

/**
 * 解析元数据
 * @param articleInfo 文章信息
 * @param htmlStr 微信文章网页源码
 * @param byline Readability解析出来的作者名
 */
let totalJsName;
function parseMeta(articleInfo: ArticleInfo, $meta: any, byline?: string) {
  // 判断是否需要下载元数据
  // if (1 != downloadOption.saveMeta) {
  //   return;
  // }
  const authorName = articleInfo.author ? articleInfo.author : getEleText($meta('#js_author_name'));
  // 缓存公众号名字，防止特殊页面获取不到
  let jsName;
  if (dlEvent == DlEventEnum.BATCH_WEB) {
    if (!totalJsName) {
      totalJsName = getEleText($meta('#js_name'));
    }
    jsName = totalJsName;
  } else {
    jsName = getEleText($meta('#js_name'));
  }
  // 封面
  let cover: string | undefined;
  if (!articleInfo.cover) {
    const coverEles = $meta('meta[property=og:image]');
    if (coverEles) {
      if (coverEles.length > 1) {
        cover = coverEles.first().attr('content');
      } else {
        cover = coverEles.attr('content');
      }
    }
  }
  const copyrightFlg = $meta('#copyright_logo')?.text() ? true : false;
  const publicTime = articleInfo.datetime ? DateUtil.format(articleInfo.datetime, 'yyyy-MM-dd HH:mm') : '';
  const ipWording = service.matchIpWording($meta.html());
  const articleMeta = new ArticleMeta();
  articleMeta.copyrightFlg = copyrightFlg;
  articleMeta.author = authorName ? authorName : byline;
  articleMeta.jsName = jsName;
  articleMeta.publicTime = publicTime;
  articleMeta.ipWording = ipWording;
  articleInfo.metaInfo = articleMeta;
  articleInfo.cover = cover;
}

function getEleText(ele: any): string {
  if (ele) {
    if (ele.length > 1) {
      return StrUtil.trim(ele.first().text());
    } else {
      return StrUtil.trim(ele.text());
    }
  }
  return '';
}

// 根据过滤规则过滤文章
function doFilter(articleInfo: ArticleInfo): { flgFilter: boolean; filterMsg: string } {
  const filterRuleStr = downloadOption.filterRule;
  if (!filterRuleStr) {
    return { flgFilter: false, filterMsg: '' };
  }

  const filterRule: FilterRuleInfo = parseFilterInfo(filterRuleStr);
  if (filterRule.titleInclude.length > 0 && !isInclude(articleInfo.title, filterRule.titleInclude)[0]) {
    return { flgFilter: true, filterMsg: '标题未包含关键词' };
  }

  if (filterRule.authInclude.length > 0 && !isInclude(articleInfo.author, filterRule.authInclude)[0]) {
    return { flgFilter: true, filterMsg: '作者未包含关键词' };
  }

  const [flgTitleInclude, titleExcludeWord] = isInclude(articleInfo.title, filterRule.titleExclude);
  if (flgTitleInclude) {
    return { flgFilter: true, filterMsg: `标题包含排除关键词 ${titleExcludeWord}` };
  }

  const [flgAuthInclude, authExcludeWord] = isInclude(articleInfo.author, filterRule.authExclude);
  if (flgAuthInclude) {
    return { flgFilter: true, filterMsg: `作者包含排除关键词 ${authExcludeWord}` };
  }

  return { flgFilter: false, filterMsg: '' };
}
/**
 * 判断内容是否包含关键词
 * @param content 内容
 * @param include 包含关键词
 */
function isInclude(content: string | undefined, include: string[]): [boolean, string] {
  if (!content) return [false, ''];
  for (const includeItem of include) {
    if (content.includes(includeItem)) {
      return [true, includeItem];
    }
  }
  return [false, ''];
}

function parseFilterInfo(filterRuleStr: string): FilterRuleInfo {
  const filterRuleInfo = new FilterRuleInfo();
  const filterRule = JSON.parse(filterRuleStr);
  if (filterRule.title) {
    const titleInclude = filterRule.title.include;
    if (titleInclude && titleInclude.length > 0) {
      filterRuleInfo.titleInclude = titleInclude;
    }
    const titleExclude = filterRule.title.exclude;
    if (titleExclude && titleExclude.length > 0) {
      filterRuleInfo.titleExclude = titleExclude;
    }
  }

  if (filterRule.auth) {
    const authInclude = filterRule.auth.include;
    if (authInclude && authInclude.length > 0) {
      filterRuleInfo.authInclude = authInclude;
    }
    const authExclude = filterRule.auth.exclude;
    if (authExclude && authExclude.length > 0) {
      filterRuleInfo.authExclude = authExclude;
    }
  }
  return filterRuleInfo;
}

/*
 * 下载评论
 */
async function downloadComment(articleInfo: ArticleInfo) {
  if (!articleInfo.html) return;

  const gzhInfo = articleInfo.gzhInfo;
  // 判断是否需要下载评论
  if (1 != downloadOption.dlComment || !gzhInfo) {
    return;
  }

  const commentId = service.matchCommentId(articleInfo.html);
  if (!commentId) {
    logger.error('获取精选评论参数失败');
    resp(NwrEnum.FAIL, '获取精选评论参数失败');
  } else if (commentId == '0') {
    logger.info(`【${articleInfo.title}】没有评论`);
    resp(NwrEnum.FAIL, `【${articleInfo.title}】没有评论`);
  } else {
    const headers = {
      Host: gzhInfo.Host,
      Connection: 'keep-alive',
      'User-Agent': gzhInfo.UserAgent,
      Cookie: gzhInfo.Cookie,
      Referer: articleInfo.contentUrl
    };
    // 评论列表
    let commentList;
    // 评论回复map
    let replyDetailMap;
    await axios
      .get(COMMENT_LIST_URL, {
        params: {
          __biz: gzhInfo.biz,
          key: gzhInfo.key,
          uin: gzhInfo.uin,
          comment_id: commentId
        },
        headers: headers
      })
      .then((response) => {
        if (response.status != 200) {
          logger.error(`获取精选评论失败，状态码：${response.status}`, articleInfo.contentUrl);
          resp(NwrEnum.FAIL, `获取精选评论失败，状态码：${response.status}`);
          return;
        }
        const resData = response.data;
        if (resData.base_resp.ret != 0) {
          logger.error(`【${articleInfo.title}】获取精选评论失败`, resData, response.config.url, response.config.params);
          resp(NwrEnum.FAIL, `【${articleInfo.title}】获取精选评论失败：${resData.errmsg}`);
          return;
        }
        if (resData.elected_comment && resData.elected_comment.length > 0) {
          commentList = resData.elected_comment;
        }
        logger.debug(`【${articleInfo.title}】精选评论`, commentList);
      })
      .catch((error) => {
        logger.error(`【${articleInfo.title}】获取精选评论失败`, error, articleInfo.contentUrl);
      });

    // 处理评论的回复
    if (1 == downloadOption.dlCommentReply && commentList) {
      replyDetailMap = new Map();
      for (const commentItem of commentList) {
        const replyInfo = commentItem.reply_new;
        if (replyInfo.reply_total_cnt > replyInfo.reply_list.length) {
          await axios
            .get(COMMENT_REPLY_URL, {
              params: {
                __biz: gzhInfo.biz,
                key: gzhInfo.key,
                uin: gzhInfo.uin,
                comment_id: commentId,
                content_id: commentItem.content_id,
                max_reply_id: replyInfo.max_reply_id
              },
              headers: headers
            })
            .then((response) => {
              if (response.status != 200) {
                logger.error(`获取评论回复失败，状态码：${response.status}`, response.config.url, response.config.params);
                resp(NwrEnum.FAIL, `获取评论回复失败，状态码：${response.status}`);
                return;
              }
              const resData = response.data;
              if (resData.base_resp.ret != 0) {
                logger.error(`获取评论回复失败`, resData, response.config.url, response.config.params);
                resp(NwrEnum.FAIL, `获取评论回复失败：${resData.errmsg}`);
                return;
              }
              replyDetailMap[commentItem.content_id] = resData.reply_list.reply_list;
            })
            .catch((error) => {
              logger.error('获取评论回复失败', error);
            });
        }
      }
    }
    articleInfo.commentList = commentList;
    articleInfo.replyDetailMap = replyDetailMap;
  }
}

/*
 * 下载图片并替换src
 * $: cheerio对象
 * savePath: 保存文章的路径(已区分文章),例如: D://savePath//测试文章1
 * tmpPath： 缓存路径(已区分文章)，例如：D://tmpPathPath//6588aec6b658b2c941f6d51d0b1691b9
 */
async function downloadImgToHtml($, savePath: string, tmpPath: string, articleInfo: ArticleInfo): Promise<{ imgCount: number }> {
  const imgArr = $('img');
  const awaitArr: Promise<void>[] = [];
  let imgCount = 0;
  // 创建保存图片的文件夹
  const imgPath = path.join(savePath, 'img');
  if (imgArr.length > 0 && !fs.existsSync(imgPath)) {
    fs.mkdirSync(imgPath, { recursive: true });
  }

  imgArr.each(function (i, elem) {
    const $ele = $(elem);
    // 文件后缀
    let fileSuf = $ele.attr('data-type');
    // 文件url
    const fileUrl = $ele.attr('data-src') || $ele.attr('src');
    if (fileUrl) {
      if (!fileSuf) {
        fileSuf = HttpUtil.getSuffByUrl(fileUrl) || 'jpg';
      }

      imgCount++;
      const tmpFileName = `${md5(fileUrl)}.${fileSuf}`;
      const fileName = `${i}.${fileSuf}`;
      const dlPromise = FileUtil.downloadFile(fileUrl, tmpPath, tmpFileName).then((_fileName) => {
        // 图片下载完成之，将图片从缓存文件夹复制到需要保存的文件夹
        $ele.attr('src', path.join('img', fileName).replaceAll('\\', '/'));
        $ele.attr('tmpsrc', path.join('md', md5(articleInfo.contentUrl), tmpFileName).replaceAll('\\', '/'));
        const resolveSavePath = path.join(imgPath, fileName);
        if (!fs.existsSync(resolveSavePath)) {
          // 复制
          fs.copyFile(path.join(tmpPath, _fileName), resolveSavePath, (err) => {
            if (err) {
              logger.error(err, `复制图片失败，名字：${_fileName}`, 'tmpPath', path.resolve(tmpPath, _fileName), 'resolveSavePath', resolveSavePath);
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
  return { imgCount: imgCount };
}

/*
 * 下载音乐并替换src
 * $: cheerio对象
 * savePath: 保存文章的路径(已区分文章),例如: D://savePath//测试文章1
 * tmpPath： 缓存路径(已区分文章)，例如：D://tmpPathPath//6588aec6b658b2c941f6d51d0b1691b9
 */
async function convertAudio($, savePath: string, tmpPath: string, articleInfo: ArticleInfo) {
  let musicArr = $('mp-common-qqmusic');
  if (musicArr.length == 0) {
    musicArr = $('qqmusic');
  }
  const compvoiceArr = $('mp-common-mpaudio');
  const mpvoiceArr = $('mpvoice');

  // 创建歌曲的文件夹
  const songPath = path.join(savePath, 'song');
  if ((musicArr.length > 0 || mpvoiceArr.length > 0 || compvoiceArr.length > 0) && !fs.existsSync(songPath)) {
    fs.mkdirSync(songPath, { recursive: true });
  }

  const awaitArr: Promise<void>[] = [];
  // 处理QQ音乐
  const gzhInfo = articleInfo.gzhInfo;
  for (let i = 0; i < musicArr.length; i++) {
    const $ele = $(musicArr[i]);
    // 歌名
    const musicName = $ele.attr('music_name');
    // 歌手名
    const singer = $ele.attr('singer');
    // 歌曲id
    const mid = $ele.attr('mid');
    if (gzhInfo) {
      // QQ音乐接口获取歌曲信息
      await axios
        .get(QQ_MUSIC_INFO_URL, {
          params: {
            __biz: gzhInfo.biz,
            key: gzhInfo.key,
            uin: gzhInfo.uin,
            song_mid: mid
          }
        })
        .then((resp) => {
          const dataObj = resp.data;
          const songDesc = JSON.parse(dataObj['resp_data']);
          const songInfo = songDesc.songlist[0];
          const songSrc = songInfo['song_play_url_standard'];
          if (songSrc) {
            const tmpFileName = `${mid}.m4a`;
            const fileName = `public_${i}.m4a`;
            awaitArr.push(downloadSong($ele, musicName, songSrc, songPath, tmpPath, tmpFileName, fileName, articleInfo, singer));
          }
        })
        .catch((error) => {
          logger.error(`音频下载失败，mid:${mid}`, error);
        });
    } else {
      const tmpFileName = `${mid}.m4a`;
      const mypath = path.resolve(tmpPath, tmpFileName);
      // 文件存在就继续
      if (fs.existsSync(mypath)) {
        const fileName = `public_${i}.m4a`;
        awaitArr.push(downloadSong($ele, musicName, '', songPath, tmpPath, tmpFileName, fileName, articleInfo, singer));
      }
    }
  }
  // 处理作者录制的音频
  for (let j = 0; j < mpvoiceArr.length; j++) {
    const $ele = $(mpvoiceArr[j]);
    // 歌名
    const musicName = $ele.attr('name');
    // 歌曲id
    const mid = $ele.attr('voice_encode_fileid');
    const songSrc = `https://res.wx.qq.com/voice/getvoice?mediaid=${mid}`;
    const tmpFileName = `${mid}.mp3`;
    const fileName = `person_${j}.mp3`;
    // 下载音频到本地
    awaitArr.push(downloadSong($ele, musicName, songSrc, songPath, tmpPath, tmpFileName, fileName, articleInfo));
  }

  for (let j = 0; j < compvoiceArr.length; j++) {
    const $ele = $(compvoiceArr[j]);
    // 歌名
    const musicName = $ele.attr('name');
    // 歌曲id
    const mid = $ele.attr('voice_encode_fileid');
    const songSrc = `https://res.wx.qq.com/voice/getvoice?mediaid=${mid}`;
    const tmpFileName = `${mid}.mp3`;
    const fileName = `person_${j}.mp3`;
    // 下载音频到本地
    awaitArr.push(downloadSong($ele, musicName, songSrc, songPath, tmpPath, tmpFileName, fileName, articleInfo));
  }

  for (const dlPromise of awaitArr) {
    await dlPromise;
  }
}
/*
 * 下载音频
 * $: cheerio对象
 * musicName：音乐名
 * songSrc：歌曲url
 * songPath：歌曲保存路径
 * tmpPath：缓存路径
 * tmpFileName：缓存歌曲文件名(缓存文件夹中的名字)
 * fileName：歌曲文件名(html中的名字)
 * singer：歌手
 */
async function downloadSong($ele, musicName: string, songSrc: string, songPath: string, tmpPath: string, tmpFileName: string, fileName: string, articleInfo: ArticleInfo, singer?: string): Promise<void> {
  if (1 == downloadOption.dlAudio) {
    resp(NwrEnum.SUCCESS, `正在下载歌曲【${musicName}】...`);
    await FileUtil.downloadFile(songSrc, tmpPath, tmpFileName).then((_fileName) => {
      // 音频下载完成之后，从缓存文件夹复制到需要保存的文件夹
      const resolveSavePath = path.join(songPath, fileName);
      if (!fs.existsSync(resolveSavePath)) {
        // 复制
        fs.copyFileSync(path.join(tmpPath, _fileName), resolveSavePath);
      }
      songSrc = path.join('song', fileName).replaceAll('\\', '/');
      const tmpSongSrc = path.join('md', md5(articleInfo.contentUrl), tmpFileName).replaceAll('\\', '/');
      addSongDiv($ele, musicName, songSrc, tmpSongSrc, singer);
      resp(NwrEnum.SUCCESS, `歌曲【${musicName}】下载完成...`);
    });
  } else {
    addSongDiv($ele, musicName, songSrc, '', singer);
  }
}
/*
 * 添加音频展示的div
 * musicName：音乐名
 * songSrc：歌曲url
 * tmpSongSrc：缓存路径的歌曲url
 * singer：歌手
 */
function addSongDiv($ele, musicName: string, songSrc: string, tmpSongSrc: string, singer?: string) {
  $ele.after(`
  <div class="music-div">
    <div>
      <div class="music_card_title">${musicName}</div>
      ${singer ? '<div class="music_card_desc">' + singer + '</div>' : ''}
    </div>
    <div class="audio-dev">
      <audio controls="controls" loop="loop">
        <source src="${songSrc}" tmpsrc="${tmpSongSrc}" type="audio/mpeg"></source>
      </audio>
    </div>
  </div>
`);
}

/*
 * 批量下载（来源是数据库）
 */
async function batchDownloadFromDb() {
  const exeStartTime = performance.now();
  if (!CONNECTION_STATE) {
    resp(NwrEnum.BATCH_FINISH, '数据库初始化失败');
    return;
  }

  const { startDate, endDate } = service.getTimeScpoe(downloadOption);
  const modSqlParams = [startDate, endDate];
  CONNECTION.query(SELECT_SQL, modSqlParams, async function (err, result) {
    if (err) {
      logger.error('获取数据库数据失败', err.message);
      resp(NwrEnum.BATCH_FINISH, '获取数据库数据失败');
    } else {
      let articleCount = 0;
      const promiseArr: Promise<void>[] = [];
      for (const dbObj of <mysql.RowDataPacket[]>result) {
        articleCount++;
        const articleInfo: ArticleInfo = service.dbObjToArticle(dbObj, downloadOption);
        promiseArr.push(dlOne(articleInfo, false));
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
      resp(NwrEnum.BATCH_FINISH, `批量下载完成，共${articleCount}篇文章，耗时${exeTime.toFixed(2)}秒`);

      finish();
    }
  });
}

/*
 * 批量下载(来源是网络)
 */
async function batchDownloadFromWeb() {
  const { startDate, endDate } = service.getTimeScpoe(downloadOption);
  const articleArr: ArticleInfo[] = [];
  const exeStartTime = performance.now();
  // 获取文章列表
  const articleCount: number[] = [0];
  await downList(0, articleArr, startDate, endDate, articleCount);

  // downList中没下载完的，在这处理
  const promiseArr: Promise<void>[] = [];
  for (const article of articleArr) {
    article.gzhInfo = GZH_INFO;
    promiseArr.push(axiosDlOne(article));
    // 下载间隔
    await sleep(downloadOption.dlInterval);
  }
  // 栅栏，等待所有文章下载完成
  for (const articlePromise of promiseArr) {
    await articlePromise;
  }

  const exeEndTime = performance.now();
  const exeTime = (exeEndTime - exeStartTime) / 1000;

  resp(NwrEnum.BATCH_FINISH, `批量下载完成，共${articleCount[0]}篇文章，耗时${exeTime.toFixed(2)}秒`);

  finish();
}
/*
 * 批量下载选择的文章
 */
async function batchDownloadFromWebSelect(articleArr: ArticleInfo[]) {
  const exeStartTime = performance.now();

  const promiseArr: Promise<void>[] = [];
  for (let i = 0; i < articleArr.length; i++) {
    const article = articleArr[i];
    if (i > 0) {
      await sleep(downloadOption.dlInterval);
    }
    // 单线程下载
    if (downloadOption.threadType == 'single') {
      await axiosDlOne(article);
    } else {
      // 多线程下载
      promiseArr.push(axiosDlOne(article));
      // 栅栏，防止一次性下载太多
      if (promiseArr.length >= DOWNLOAD_LIMIT) {
        for (let i = 0; i < DOWNLOAD_LIMIT; i++) {
          const p = promiseArr.shift();
          await p;
        }
      }
    }
  }
  // 栅栏，等待所有文章下载完成
  for (const articlePromise of promiseArr) {
    await articlePromise;
  }

  const exeEndTime = performance.now();
  const exeTime = (exeEndTime - exeStartTime) / 1000;

  resp(NwrEnum.BATCH_FINISH, `批量下载完成，共${articleArr.length}篇文章，耗时${exeTime.toFixed(2)}秒`);

  finish();
}

/*
 * 获取文章列表
 * nextOffset: 微信获取文章列表所需参数
 * articleArr：文章信息
 * startDate：过滤开始时间
 * endDate：过滤结束时间
 * articleCount：文章数量
 */
async function downList(nextOffset: number, articleArr: ArticleInfo[], startDate: Date, endDate: Date, articleCount: number[]) {
  let dataObj;
  logger.debug('下载文章列表', `${LIST_URL}&__biz=${GZH_INFO.biz}&key=${GZH_INFO.key}&uin=${GZH_INFO.uin}&pass_ticket=${GZH_INFO.passTicket}&offset=${nextOffset}`);
  await axios
    .get(LIST_URL, {
      params: {
        __biz: GZH_INFO.biz,
        key: GZH_INFO.key,
        uin: GZH_INFO.uin,
        pass_ticket: GZH_INFO.passTicket,
        offset: nextOffset
      },
      headers: {
        Host: GZH_INFO.Host,
        Connection: 'keep-alive',
        'User-Agent': GZH_INFO.UserAgent,
        Cookie: GZH_INFO.Cookie,
        Referer: `https://mp.weixin.qq.com/mp/profile_ext?action=home&lang=zh_CN&__biz=${GZH_INFO.biz}&uin=${GZH_INFO.uin}&key=${GZH_INFO.key}&pass_ticket=${GZH_INFO.passTicket}`
      }
    })
    .then((response) => {
      if (response.status != 200) {
        logger.error(`获取文章列表失败，状态码：${response.status}`, GZH_INFO);
        resp(NwrEnum.FAIL, `获取文章列表失败，状态码：${response.status}`);
        return;
      }
      dataObj = response.data;
      logger.debug('列表数据', dataObj);
    })
    .catch((error) => {
      logger.error('获取文章列表失败', error, GZH_INFO);
    });
  if (!dataObj) return;
  const oldArticleLengh = articleArr.length;
  const errmsg = dataObj['errmsg'];
  if ('ok' != errmsg) {
    logger.error('获取文章列表失败', `${LIST_URL}&__biz=${GZH_INFO.biz}&key=${GZH_INFO.key}&uin=${GZH_INFO.uin}&pass_ticket=${GZH_INFO.passTicket}&offset=${nextOffset}`, dataObj);
    resp(NwrEnum.FAIL, `获取文章列表失败，错误信息：${errmsg}`);
    return;
  }
  const generalMsgList = JSON.parse(dataObj['general_msg_list']);
  let flgContinue = true;

  for (const generalMsg of generalMsgList['list']) {
    const commMsgInfo = generalMsg['comm_msg_info'];
    const appMsgExtInfo = generalMsg['app_msg_ext_info'];

    const dateTime = new Date(commMsgInfo['datetime'] * 1000);
    // 判断，如果小于开始时间，直接退出
    if (dateTime < startDate) {
      flgContinue = false;
      break;
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
  resp(NwrEnum.SUCCESS, `正在获取文章列表，目前数量：${articleCount[0]}`);
  // 单线程下载
  if (downloadOption.threadType == 'single') {
    for (let i = 0; i < articleArr.length; i++) {
      const article = articleArr.shift();
      if (article) {
        article.gzhInfo = GZH_INFO;
        await axiosDlOne(article);
        // 下载间隔
        await sleep(downloadOption.dlInterval);
      }
    }
  } else {
    // 多线程下载
    // 文章数量超过限制，则开始下载详情页
    while (articleArr.length >= DOWNLOAD_LIMIT) {
      const promiseArr: Promise<void>[] = [];
      for (let i = 0; i < DOWNLOAD_LIMIT; i++) {
        const article = articleArr.shift();
        if (article) {
          article.gzhInfo = GZH_INFO;
          promiseArr.push(axiosDlOne(article));
          // 下载间隔
          await sleep(downloadOption.dlInterval);
        }
      }
      // 栅栏，等待所有文章下载完成
      for (const articlePromise of promiseArr) {
        await articlePromise;
      }
    }
  }

  if (flgContinue && dataObj['can_msg_continue'] == 1) {
    await downList(dataObj['next_offset'], articleArr, startDate, endDate, articleCount);
  }
}

function resp(code: NwrEnum, message: string, data?) {
  logger.info('resp', code, message, data);
  if (port) port.postMessage(new NodeWorkerResponse(code, message, data));
}

/*
 * 创建mysql数据库连接
 */
async function createMysqlConnection(): Promise<mysql.Connection> {
  if (1 != downloadOption.dlMysql && 'db' != downloadOption.dlSource) return CONNECTION;
  if (CONNECTION) {
    CONNECTION.end();
  }

  CONNECTION = mysql.createConnection(connectionConfig);
  // 这里是想阻塞等待连接成功
  return new Promise((resolve) => {
    const sql = 'show tables';
    CONNECTION.query(sql, (err) => {
      if (err) {
        resp(NwrEnum.FAIL, 'mysql连接失败');
        logger.error('mysql连接失败', err);
      } else {
        resp(NwrEnum.SUCCESS, 'mysql连接成功');
        logger.info('连接成功');
        CONNECTION_STATE = true;
      }
      resolve(CONNECTION);
    });
  });
}
/*
 * 收尾方法
 */
function finish() {
  // 关闭数据库连接
  if (CONNECTION) {
    CONNECTION.end();
  }
  // 通知主线程关闭此线程
  resp(NwrEnum.CLOSE, '');
}
