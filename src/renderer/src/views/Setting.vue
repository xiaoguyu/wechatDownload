<template>
  <el-container>
    <el-header height="35px">
      首次运行需要安装证书(安装一次即可)，请手动完成此设置：
      <el-button type="primary" size="small" @click="installLicence">安装证书</el-button>
      <el-button type="primary" size="small" @click="openLicence">打开证书路径</el-button>
    </el-header>
    <el-main>
      <el-row :gutter="5">
        <el-col :span="12">
          <div class="div-border div-pd">
            <span class="line-center">下载来源 </span>
            <el-radio-group v-model="settingInfo.dlSource">
              <el-radio-button label="网络" value="web" />
              <el-radio-button label="数据库" value="db" />
            </el-radio-group>
          </div>
          <div class="div-border div-pd" title="json格式">
            <span>过滤规则</span>
            <el-input v-model="settingInfo.filterRule" placeholder="输入微信文章链接，点击右侧下载按钮" />
          </div>
          <div class="div-border div-pd">
            <el-row>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.dlHtml" label="下载为html" size="large" />
              </el-col>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.dlAudio" label="下载音频到本地" size="large" />
              </el-col>
            </el-row>
            <el-row>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.dlMarkdown" label="下载为markdown" size="large" />
              </el-col>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.dlImg" label="下载图片到本地" size="large" />
              </el-col>
            </el-row>
            <el-row>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.dlPdf" label="下载为pdf" size="large" />
              </el-col>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.dlComment" label="下载评论" size="large" />
              </el-col>
            </el-row>
            <el-row>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.dlMysql" label="保存至Mysql" size="large" />
              </el-col>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.dlCommentReply" label="下载评论回复" size="large" />
              </el-col>
            </el-row>
            <el-row>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.skinExist" label="跳过现有文章" size="large" />
              </el-col>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.sourceUrl" label="添加原文链接" size="large" />
              </el-col>
            </el-row>
            <el-row>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.saveMeta" label="保存元数据" size="large" />
              </el-col>
              <el-col :span="12">
                <el-checkbox v-model="settingInfo.classifyDir" label="按公号分类保存" size="large" />
              </el-col>
            </el-row>
          </div>
        </el-col>
        <el-col :span="12"
          ><div class="grid-content ep-bg-purple" />
          <div class="item div-border div-pd">
            <div>下载范围</div>
            <el-radio-group v-model="settingInfo.dlScpoe">
              <el-radio-button label="全部" value="all" />
              <el-radio-button label="今日" value="one" />
              <el-radio-button label="7天内" value="seven" />
              <el-radio-button label="一个月内" value="month" />
              <el-radio-button label="自定义" value="diy" />
            </el-radio-group>
            <div v-if="settingInfo.dlScpoe === 'diy'" style="margin-top: 5px">
              <el-date-picker v-model="settingInfo.startDate" style="width: 180px" type="date" placeholder="选择开始日期" format="YYYY年MM月DD日" value-format="YYYY-MM-DD"></el-date-picker>
              <el-date-picker v-model="settingInfo.endDate" style="width: 180px" type="date" placeholder="选择结束日期" format="YYYY年MM月DD日" value-format="YYYY-MM-DD"></el-date-picker>
            </div>
          </div>
          <div title="不懂的建议使用默认配置,间隔:500,单批:10" class="div-border div-pd">
            <div>
              <span class="line-center">线程配置 </span>
              <el-radio-group v-model="settingInfo.threadType">
                <el-radio-button label="单线程" value="single" />
                <el-radio-button label="多线程" value="multi" />
              </el-radio-group>
            </div>
            <div>
              <span title="单位毫秒">
                下载间隔
                <el-input-number v-model="settingInfo.dlInterval" controls-position="right" precision="0" style="width: 100px" size="small" :min="0" />
              </span>
              <span class="batch-limit"> 单批数量：<el-input-number v-model="settingInfo.batchLimit" controls-position="right" precision="0" style="width: 100px" size="small" :min="0" /> </span>
            </div>
          </div>
          <div v-if="settingInfo.dlMysql" class="div-border div-pd">
            <div style="margin-bottom: 5px"><span>Mysql配置：</span><el-button type="primary" size="small" @click="testConnect">测试连接</el-button></div>
            <el-form :model="settingInfo" label-width="auto">
              <el-form-item label="主机">
                <el-input v-model="settingInfo.mysqlHost" />
              </el-form-item>
              <el-form-item label="端口">
                <el-input v-model="settingInfo.mysqlPort" />
              </el-form-item>
              <el-form-item label="用户名">
                <el-input v-model="settingInfo.mysqlUser" />
              </el-form-item>
              <el-form-item label="密码">
                <el-input v-model="settingInfo.mysqlPassword" />
              </el-form-item>
              <el-form-item label="数据库">
                <el-input v-model="settingInfo.mysqlDatabase" />
              </el-form-item>
              <el-form-item label="表名">
                <el-input v-model="settingInfo.tableName" />
              </el-form-item>
            </el-form>
          </div>
        </el-col>
      </el-row>
    </el-main>
    <el-footer style="height: auto; margin-bottom: 5px">
      <div class="foot-item">
        <el-input v-model="settingInfo.savePath" class="path-input" disabled placeholder="请选择保存路径" />
        <el-button type="primary" @click="chosePath('savePath')">选择保存路径</el-button>
      </div>
      <div class="foot-item">
        <el-input v-model="settingInfo.tmpPath" class="path-input" disabled placeholder="请选择缓存路径" />
        <el-button type="primary" @click="chosePath('tmpPath')">选择缓存路径</el-button>
      </div>
      <div>
        <div style="margin-bottom: 5px">
          <span style="margin-right: 5px">当前版本：{{ updateInfo.version }}</span>
          <el-button type="primary" @click="checkUpdate">检查更新</el-button>
          <el-button type="primary" @click="openLogsDir">打开日志位置</el-button>
        </div>
        <el-progress v-if="updateInfo.code == 3" :percentage="updateInfo.percentage"> {{ updateInfo.percentageMsg }} </el-progress>
        <div v-if="updateInfo.code > 0 && updateInfo.code != 3">{{ updateInfo.msg }}</div>
      </div>
    </el-footer>
  </el-container>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import { OpenDialogOptions } from 'electron';
import { ProgressInfo } from 'builder-util-runtime';

const settingInfo = reactive({
  // 下载来源
  dlSource: 'web',
  // 线程类型
  threadType: 'multi',
  // 下载间隔
  dlInterval: 500,
  // 单批数量
  batchLimit: 5,
  // 下载为html
  dlHtml: true,
  // 下载为markdown
  dlMarkdown: 1,
  // 下载为pdf
  dlPdf: 0,
  // 保存至mysql
  dlMysql: 0,
  // 下载音频到本地
  dlAudio: 0,
  // 下载图片到本地
  dlImg: 0,
  // 跳过现有文章
  skinExist: 1,
  // 是否保存元数据
  saveMeta: 1,
  // 按公号名字分类
  classifyDir: 1,
  // 添加原文链接
  sourceUrl: 1,
  // 是否下载评论
  dlComment: 0,
  // 是否下载评论回复
  dlCommentReply: 0,
  // 下载范围-7天内
  dlScpoe: 'seven',
  startDate: '',
  endDate: '',
  // 缓存目录
  tmpPath: '',
  // 在安装目录下创建文章的保存路径
  savePath: '',
  mysqlHost: 'localhost',
  mysqlPort: '3306',
  mysqlUser: '',
  mysqlPassword: '',
  mysqlDatabase: '',
  tableName: '',
  filterRule: ''
});
let settingInfoOrigin;

const updateInfo = reactive({
  version: 'v1.0',
  code: 0,
  msg: '',
  percentage: 0,
  percentageMsg: '0/0 M'
});

/**
 * 监听数据变化
 */
watch(settingInfo, async (_oldInfo, newInfo) => {
  for (const settingKey in newInfo) {
    const settingItem = newInfo[settingKey];
    if (settingItem != settingInfoOrigin[settingKey]) {
      storeSet(settingKey, settingItem);
    }
  }
  settingInfoOrigin = Object.assign({}, newInfo);
});
// 初始化所有设置
initSetting();
// 初始化信息
initInfo();

/**
 * 初始化所有设置并赋值
 */
function initSetting() {
  for (const settingItem in settingInfo) {
    let newValue = storeGet(settingItem);
    // 兼容旧版本的checkbox的0/1
    if (newValue && settingItem != 'dlInterval' && settingItem != 'batchLimit') {
      if (newValue == '1') {
        newValue = true;
      } else if (newValue == '0') {
        newValue = false;
      }
    }
    settingInfo[settingItem] = newValue;
  }
  settingInfoOrigin = Object.assign({}, settingInfo);
}
/**
 * 加载初始化信息
 */
function initInfo() {
  const _version: string = window.api.loadInitInfo();
  updateInfo.version = _version;
}

/**
 * 安装证书
 */
function installLicence() {
  window.api.installLicence();
}
/**
 * 打开证书路径
 */
function openLicence() {
  window.api.openPath(storeGet('caPath'));
}
/**
 * 测试mysql连接
 */
function testConnect() {
  window.api.testConnect();
}
/**
 * 选择保存路径/缓存路径
 */
function chosePath(pathKey: string) {
  const options: OpenDialogOptions = {
    title: '请选择保存路径',
    defaultPath: storeGet(pathKey),
    properties: ['openDirectory']
  };
  window.api.showOpenDialog(options, pathKey);
}
/**
 * 检查更新
 */
function checkUpdate() {
  window.api.checkForUpdate();
}
/**
 * 打开日志文件夹
 */
function openLogsDir() {
  window.api.openLogsDir();
}

function storeGet(key: string): any {
  return window.api.store.get(key);
}

async function storeSet(key: string, value: string | number) {
  window.api.store.set(key, value);
}
/**
 * 选择保存路径/缓存路径的回调
 */
window.api.openDialogCallback(async (_event, callbackMsg: string, pathStr: string) => {
  settingInfo[callbackMsg] = pathStr;
});
/**
 * 接收更新信息
 */
window.api.updateMsg((_event, msgObj: any) => {
  updateInfo.code = msgObj.code;
  updateInfo.msg = msgObj.msg;
});
// 接收下载进度
const numM = 1048576;
window.api.downloadProgress(async (_event, progressObj: ProgressInfo) => {
  updateInfo.percentage = progressObj.percent;
  const totalM = (progressObj.total / numM).toFixed(2);
  const transferredM = (progressObj.transferred / numM).toFixed(2);
  updateInfo.percentageMsg = `${transferredM}/${totalM}M`;
});
</script>

<style scoped>
.line-center {
  vertical-align: -webkit-baseline-middle;
}

.el-header {
  --el-header-padding: 0 10px;
}

.el-main {
  --el-main-padding: 0 10px 10px 10px;
}

.el-form-item {
  margin-bottom: 5px;
}

.el-checkbox {
  height: 32px;
}

.div-border {
  border: 1px solid var(--el-border-color);
}

.div-pd {
  width: 100%;
  padding: 8px;
  margin-bottom: 5px;
}

.path-input {
  margin-right: 5px;
}

.foot-item {
  display: flex;
  margin-bottom: 5px;
}
</style>
