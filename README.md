# wechatDownload

微信公众号文章下载工具

## 项目介绍

### 技术栈

Electron + Typescript

### 原理

获取微信公号文章列表，需要 3 个特殊参数：

- \_biz：公众号的 id
- uin：微信用户的 ID
- key：不知道是啥

这 3 个参数通过 http 代理获取，剩下的就是普通爬虫的做法了

### 使用

![image-20230112181356841](https://img.javaedit.com/images/2023/02/07/20450813ab77bc1c8ed7528fff28185a.png)

![image-20230117115453694](https://img.javaedit.com/images/2023/02/07/400719351ac56cc0a92593ab3c86ff3a.png)

- 单篇文章下载

  直接输入链接，点击下载按钮即可

- 批量下载

  1. 初次使用请安装证书,设置中心 → 打开证书路径 → 打开rootCA.crt文件
    ![Untitled](https://img.javaedit.com/images/2023/02/07/1dc6bcf1c15dd3cb17985eb555027c2b.png)
  2. 需要安装电脑版微信
  3. 点击**批量下载**按钮，开始监听微信公号数据
  4. 在电脑版微信打开一篇需要下载的公号的文章
  5. 回到WechatDownload，会弹框提示
    ![wechatDownload.gif](https://img.javaedit.com/images/2023/02/07/693133554baca2716bc52206f1d5613b.gif)

- 保存至 MySql

  需要执行 /doc/mysql.sql 文件中的 SQL 语句创建表

### 功能

设置中心有啥就支持啥

待添加：

- [x] 下载保存至数据库
- [x] 支持数据来源（从微信接口获取 or 数据库获取）
- [x] 支持音频
- [x] 支持视频
- [x] 支持评论

## 源码运行&编译

### 安装

```bash
$ npm install
```

### 调试

```bash
$ npm run dev
```

### 编译

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
