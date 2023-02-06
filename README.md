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

![image-20230112181356841](https://img.javaedit.com/images/2023/01/12/fe4b589cdf114a09f632cf8fa5e55f0c.png)

![image-20230117115453694](https://img.javaedit.com/images/2023/01/17/7e2fbcb74217368ecb5fe347b173a0d0.png)

- 单篇文章下载

  直接输入链接，点击下载按钮即可

- 批量下载

  1. 安装证书：去**设置中心**页面，点击**打开证书路径**按钮，双击**rootCA.crt**文件进行安装（已经安装过证书的忽略此步骤）
  2. 点击**批量下载**按钮，开始监听微信公号数据
  3. 在 PC 版微信中随意打开一篇需要批量下载的公号的文章（点击批量下载按钮前就打开的文章不算，别偷懒）
  4. wechatDownload 弹框确认监听到的文章是否正确，选择是则直接开始批量下载

- 保存至 MySql

  需要执行 /doc/mysql.sql 文件中的 SQL 语句创建表

### 功能

设置中心有啥就支持啥

待添加：

- [x] 下载保存至数据库
- [x] 支持数据来源（从微信接口获取 or 数据库获取）
- [x] 支持音频
- [ ] 支持视频

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
