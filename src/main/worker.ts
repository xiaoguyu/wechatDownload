import { parentPort, workerData } from 'worker_threads';
import logger from './logger';
import { StrUtil, FileUtil, DateUtil } from './utils';
import { GzhInfo, ArticleInfo, PdfInfo, DownloadOption, Service, NodeWorkerResponse, NwrEnum, DlEventEnum } from './service';
import axios from 'axios';
import md5 from 'blueimp-md5';
import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql';
import * as Readability from '@mozilla/readability';

const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');
const service = new Service();
// html转markdown的TurndownService
const turndownService = service.createTurndownService();
// 下载数量限制
// 获取文章列表时，数量查过此限制不再继续获取列表，而是采集详情页后再继续获取列表
const DOWNLOAD_LIMIT = 10;
// 获取文章列表的url
const LIST_URL = 'https://mp.weixin.qq.com/mp/profile_ext?action=getmsg&f=json&count=10&is_ok=1';
const COMMENT_LIST_URL = 'https://mp.weixin.qq.com/mp/appmsg_comment?action=getcomment&offset=0&limit=100&f=json';
const COMMENT_REPLY_URL = 'https://mp.weixin.qq.com/mp/appmsg_comment?action=getcommentreply&offset=0&limit=100&is_first=1&f=json';
// 插入数据库的sql
const TABLE_NAME = workerData.tableName;
const INSERT_SQL = `INSERT INTO ${TABLE_NAME} ( title, content, author, content_url, create_time, copyright_stat, comm, comm_reply) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title = ? , create_time=?`;
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

const port = parentPort;
if (!port) throw new Error('IllegalState');

// 接收消息，执行任务
port.on('message', async () => {
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
});

port.on('close', () => {
  logger.info('on 线程关闭');
});

port.addListener('close', () => {
  logger.info('addListener 线程关闭');
});

async function axiosDlOne(articleInfo: ArticleInfo) {
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
  await dlOne(articleInfo);
}

/*
 * 下载单个页面
 */
async function dlOne(articleInfo: ArticleInfo, saveToDb = true) {
  // 预处理微信公号文章html
  if (!articleInfo.html) return;
  const url = articleInfo.contentUrl;
  const htmlStr = service.prepHtml(articleInfo.html);
  // 提取正文
  const doc = new JSDOM(htmlStr);
  const reader = new Readability.Readability(<Document>doc.window.document, { keepClasses: true });
  const article = reader.parse();
  if (!article) {
    resp(NwrEnum.FAIL, '提取正文失败');
    return;
  }
  if (!articleInfo.title) articleInfo.title = article.title;
  if (!articleInfo.author) articleInfo.author = article.byline;
  if (!articleInfo.datetime) articleInfo.datetime = service.matchCreateTime(htmlStr);

  // 下载评论
  await downloadComment(articleInfo);

  // 创建保存文件夹和缓存文件夹
  const timeStr = articleInfo.datetime ? DateUtil.format(articleInfo.datetime, 'yyyy-MM-dd') + '-' : '';
  const saveDirName = StrUtil.strToDirName(article.title);
  const savePath = path.join(downloadOption.savePath || '', timeStr + saveDirName);
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  } else {
    // 跳过已有文章
    if (downloadOption.skinExist && downloadOption.skinExist == 1) {
      resp(NwrEnum.SUCCESS, `【${saveDirName}】已存在，跳过此文章`);
      return;
    }
  }
  const tmpPath = path.join(downloadOption.tmpPath || '', md5(url));
  if (!fs.existsSync(tmpPath)) {
    fs.mkdirSync(tmpPath, { recursive: true });
  }

  // 判断是否需要下载图片
  let imgCount = 0;
  const $ = cheerio.load(article.content);
  if (1 == downloadOption.dlImg) {
    await downloadImgToHtml($, savePath, tmpPath).then((obj) => {
      imgCount = obj.imgCount;
    });
  }

  // 处理音频
  await convertAudio($, savePath, tmpPath);

  const readabilityPage = $('#readability-page-1');
  // 插入原文链接
  readabilityPage.prepend(`<div>原文地址：<a href='${url}' target='_blank'>${article.title}</a></div>`);
  // 插入标题
  readabilityPage.prepend(`<h1>${article.title}</h1>`);

  const proArr: Promise<void>[] = [];
  // 判断是否保存到数据库
  if (1 == downloadOption.dlMysql && CONNECTION.state == 'authenticated' && saveToDb) {
    proArr.push(
      new Promise((resolve, _reject) => {
        const modSqlParams = [articleInfo.title, articleInfo.html, articleInfo.author, articleInfo.contentUrl, articleInfo.datetime, articleInfo.copyrightStat, JSON.stringify(articleInfo.commentList), JSON.stringify(articleInfo.replyDetailMap), articleInfo.title, articleInfo.datetime];
        CONNECTION.query(INSERT_SQL, modSqlParams, function (err, _result) {
          if (err) {
            logger.error('mysql插入失败', err.message);
          } else {
            logger.info('mysql更新成功');
          }
          resolve();
        });
      })
    );
  }
  // 判断是否保存markdown
  if (1 == downloadOption.dlMarkdown) {
    const markdownStr = turndownService.turndown($.html());
    proArr.push(
      new Promise((resolve, _reject) => {
        // 添加评论
        const commentStr = service.getMarkdownComment(articleInfo.commentList, articleInfo.replyDetailMap);
        fs.writeFile(path.join(savePath, 'index.md'), markdownStr + commentStr, () => {
          resp(NwrEnum.SUCCESS, `【${article.title}】保存Markdown完成`);
          resolve();
        });
      })
    );
  }
  // 判断是否保存html
  if (1 == downloadOption.dlHtml) {
    const $html = cheerio.load($.html());
    // 添加样式美化
    const headEle = $html('head');
    headEle.append(service.getArticleCss());
    // 添加评论数据
    if (articleInfo.commentList) {
      headEle.after(service.getHtmlComment(articleInfo.commentList, articleInfo.replyDetailMap));
    }
    const htmlReadabilityPage = $html('#readability-page-1');
    proArr.push(
      new Promise((resolve, _reject) => {
        // 评论的div块
        htmlReadabilityPage.after('<div class="foot"></div><div class="dialog"><div class="dcontent"><div class="aclose"><span>留言</span><a class="close"href="javascript:closeDialog();">&times;</a></div><div class="contain"><div class="d-top"></div><div class="all-deply"></div></div></div></div>');
        fs.writeFile(path.join(savePath, 'index.html'), $html.html(), () => {
          resp(NwrEnum.SUCCESS, `【${article.title}】保存HTML完成`);
          resolve();
        });
      })
    );
  }
  // 判断是否保存pdf
  if (1 == downloadOption.dlPdf) {
    const $pdf = cheerio.load($.html());
    // 添加样式美化
    const headEle = $pdf('head');
    headEle.append(service.getArticleCss());
    // 添加评论数据
    if (articleInfo.commentList) {
      headEle.after(service.getHtmlComment(articleInfo.commentList, articleInfo.replyDetailMap, true));
    }
    const htmlReadabilityPage = $pdf('#readability-page-1');
    proArr.push(
      new Promise((resolve, _reject) => {
        // 评论的div块
        htmlReadabilityPage.after('<div class="foot"></div><div class="dialog"><div class="dcontent"><div class="aclose"><span>留言</span><a class="close"href="javascript:closeDialog();">&times;</a></div><div class="contain"><div class="d-top"></div><div class="all-deply"></div></div></div></div>');
        fs.writeFile(path.join(savePath, 'pdf.html'), $pdf.html(), () => {
          resp(NwrEnum.SUCCESS, `【${article.title}】保存pdf的html文件完成`);
          resp(NwrEnum.PDF, '保存pdf', new PdfInfo(article.title, savePath));
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
    const replyDetailMap = new Map();
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
        if (resData.base_resp.errmsg != 'ok') {
          logger.error(`【${articleInfo.title}】获取精选评论失败`, resData.base_resp, articleInfo.contentUrl);
          resp(NwrEnum.FAIL, `【${articleInfo.title}】获取精选评论失败：${resData.base_resp.errmsg}`);
          return;
        }
        commentList = resData.elected_comment;
        logger.debug(`【${articleInfo.title}】精选评论`, commentList);
      })
      .catch((error) => {
        logger.error(`【${articleInfo.title}】获取精选评论失败`, error, articleInfo.contentUrl);
      });

    // 处理评论的回复
    if (1 == downloadOption.dlCommentReply && commentList) {
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
                logger.error(`获取评论回复失败，状态码：${response.status}`);
                resp(NwrEnum.FAIL, `获取评论回复失败，状态码：${response.status}`);
                return;
              }
              const resData = response.data;
              if (resData.base_resp.errmsg != 'ok') {
                logger.error(`获取评论回复失败`, resData.base_resp);
                resp(NwrEnum.FAIL, `获取评论回复失败：${resData.base_resp.errmsg}`);
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
async function downloadImgToHtml($, savePath: string, tmpPath: string): Promise<{ imgCount: number }> {
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
async function convertAudio($, savePath: string, tmpPath: string) {
  const musicArr = $('qqmusic');
  const mpvoiceArr = $('mpvoice');

  // 创建歌曲的文件夹
  const songPath = path.join(savePath, 'song');
  if ((musicArr.length > 0 || mpvoiceArr.length > 0) && !fs.existsSync(songPath)) {
    fs.mkdirSync(songPath, { recursive: true });
  }

  const awaitArr: Promise<void>[] = [];
  // 处理QQ音乐
  for (const elem of musicArr) {
    const $ele = $(elem);
    // 歌名
    const musicName = $ele.attr('music_name');
    // 歌手名
    const singer = $ele.attr('singer');
    // 歌曲id
    const mid = $ele.attr('mid');
    // QQ音乐接口获取歌曲信息
    await axios
      .get(`https://mp.weixin.qq.com/mp/qqmusic?action=get_song_info&song_mid=${mid}`)
      .then((resp) => {
        const dataObj = resp.data;
        const songDesc = JSON.parse(dataObj['resp_data']);
        const songInfo = songDesc.songlist[0];
        const songSrc = songInfo['song_play_url_standard'];
        if (songSrc) {
          const fileName = `${mid}.m4a`;
          awaitArr.push(downloadSong($ele, musicName, songSrc, songPath, tmpPath, fileName, singer));
        }
      })
      .catch((error) => {
        logger.error(`音频下载失败，mid:${mid}`, error);
      });
  }
  // 处理作者录制的音频
  for (const elem of mpvoiceArr) {
    const $ele = $(elem);
    // 歌名
    const musicName = $ele.attr('name');
    // 歌曲id
    const mid = $ele.attr('voice_encode_fileid');
    const songSrc = `https://res.wx.qq.com/voice/getvoice?mediaid=${mid}`;
    const fileName = `${mid}.mp3`;
    // 下载音频到本地
    awaitArr.push(downloadSong($ele, musicName, songSrc, songPath, tmpPath, fileName));
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
 * fileName：歌曲文件名
 * singer：歌手
 */
async function downloadSong($ele, musicName: string, songSrc: string, songPath: string, tmpPath: string, fileName: string, singer?: string): Promise<void> {
  if (1 == downloadOption.dlAudio) {
    resp(NwrEnum.SUCCESS, `正在下载歌曲【${musicName}】...`);
    await FileUtil.downloadFile(songSrc, tmpPath, fileName).then((_fileName) => {
      // 音频下载完成之后，从缓存文件夹复制到需要保存的文件夹
      const resolveSavePath = path.join(songPath, _fileName);
      if (!fs.existsSync(resolveSavePath)) {
        // 复制
        fs.copyFileSync(path.join(tmpPath, _fileName), resolveSavePath);
      }
      songSrc = path.join('song', _fileName);
      addSongDiv($ele, musicName, songSrc, singer);
      resp(NwrEnum.SUCCESS, `歌曲【${musicName}】下载完成...`);
    });
  } else {
    addSongDiv($ele, musicName, songSrc, singer);
  }
}
/*
 * 添加音频展示的div
 * musicName：音乐名
 * songSrc：歌曲url
 * singer：歌手
 */
function addSongDiv($ele, musicName: string, songSrc: string, singer?: string) {
  $ele.after(`
  <div class="music-div">
    <div>
      <div class="music_card_title">${musicName}</div>
      ${singer ? '<div class="music_card_desc">' + singer + '</div>' : ''}
    </div>
    <div class="audio-dev">
      <audio controls="controls" loop="loop">
        <source src="${songSrc}" type="audio/mpeg"></source>
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
  if (CONNECTION.state != 'authenticated') {
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
      for (const dbObj of result) {
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
  for (const article of articleArr) {
    promiseArr.push(axiosDlOne(article));
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
    logger.error('获取文章列表失败', `${LIST_URL}&__biz=${GZH_INFO.biz}&key=${GZH_INFO.key}&uin=${GZH_INFO.uin}&pass_ticket=${GZH_INFO.passTicket}&offset=${nextOffset}`);
    resp(NwrEnum.FAIL, `获取文章列表失败，错误信息：${errmsg}`);
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
  resp(NwrEnum.SUCCESS, `正在获取文章列表，目前数量：${articleCount[0]}`);
  // 文章数量超过限制，则开始下载详情页
  while (articleArr.length >= DOWNLOAD_LIMIT) {
    const promiseArr: Promise<void>[] = [];
    for (let i = 0; i < DOWNLOAD_LIMIT; i++) {
      const article = articleArr.shift();
      if (article) {
        promiseArr.push(axiosDlOne(article));
      }
    }
    // 栅栏，等待所有文章下载完成
    for (const articlePromise of promiseArr) {
      await articlePromise;
    }
  }

  if (dataObj['can_msg_continue'] == 1) {
    await downList(dataObj['next_offset'], articleArr, startDate, endDate, articleCount);
  }
}

function resp(code: NwrEnum, message: string, data?) {
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
  return new Promise((resolve, _reject) => {
    CONNECTION.connect(() => {
      const sql = 'show tables';
      CONNECTION.query(sql, (err) => {
        if (err) {
          resp(NwrEnum.FAIL, 'mysql连接失败');
          logger.error('mysql连接失败', err);
        } else {
          resp(NwrEnum.SUCCESS, 'mysql连接成功');
          logger.info('连接成功');
        }
        resolve(CONNECTION);
      });
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
