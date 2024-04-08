<template>
  <el-container style="height: 100%">
    <el-header height="40px">
      <div class="tool-div" style="display: flex">
        <el-input v-model="dlUrl" placeholder="输入微信文章链接，点击右侧下载按钮" />
        <div class="tool-div-btn">
          <el-button type="primary" @click="dlOne">下载</el-button>
          <el-button type="primary" :disabled="btnInfo.batchBtn" @click="dlBatch">批量下载</el-button>
          <el-button :class="{ active: btnInfo.restrictionsClass }" type="primary" :disabled="btnInfo.restrictionsBtn" @click="dlRestrictionsBatch">监控下载</el-button>
        </div>
      </div>
    </el-header>
    <el-main>
      <div v-if="logArr.length === 0" class="desc-div">
        <p>本软件开源免费！</p>
        <p>
          源码地址：
          <a target="_blank" href="https://github.com/xiaoguyu/wechatDownload">wechatDownload</a>
        </p>
        <p>初次运行请花点时间看看此说明！</p>
        <p>单篇文章下载输入链接可直接使用，批量下载功能需要开启代理</p>
        <p>使用代理需要安装证书，证书路径请前往设置中心查看</p>
        <p>证书安装完成请重启软件再使用</p>
        <p>Window：证书直接双击 rootCA.crt 安装即可</p>
        <p>Mac：别问我，问就是没Mac</p>
        <p>Ubuntu：别问了，不会</p>
        <p>电脑没法上网可能是代理问题，试试打开此软件再关闭软件</p>
      </div>
      <el-scrollbar v-if="logArr.length > 0" ref="scrollbarRef" style="word-wrap: break-word">
        <div ref="innerRef">
          <div v-for="(logItem, i) in logArr" :key="i">
            <p v-if="logItem.flgHtml" v-html="logItem.msg"></p>
            <p v-else>{{ logItem.msg }}</p>
          </div>
        </div>
      </el-scrollbar>
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { ElScrollbar } from 'element-plus';
import { nextTick, reactive, ref } from 'vue';

const dlUrl = ref('');
const innerRef = ref<HTMLDivElement>();
const scrollbarRef = ref<InstanceType<typeof ElScrollbar>>();
class LogInfo {
  msg: string;
  flgHtml: boolean;

  constructor(msg: string, flgHtml: boolean) {
    this.msg = msg;
    this.flgHtml = flgHtml;
  }
}
const logArr = reactive([] as LogInfo[]);
const btnInfo = reactive({
  batchBtn: false,
  restrictionsBtn: false,
  restrictionsClass: false
});

/**
 * 下载按钮事件
 */
function dlOne() {
  const url = dlUrl.value;
  const checkResult = checkURL(url);
  if (!checkResult) {
    window.api.showMessageBox({
      type: 'warning',
      message: '请输入正确的url'
    });
    return;
  }
  // 下载详情页数据
  window.api.downloadOne(url);
}
/**
 * 批量下载按钮事件
 */
function dlBatch() {
  btnInfo.batchBtn = true;
  window.api.monitorArticle();
}
/**
 * 监控下载按钮事件
 */
function dlRestrictionsBatch() {
  btnInfo.restrictionsClass = !btnInfo.restrictionsClass;
  // 开始监控
  if (btnInfo.restrictionsClass) {
    window.api.monitorLimitArticle();
  } else {
    // 结束监控
    window.api.stopMonitorLimitArticle();
  }
}
/*
 * 校验url
 */
function checkURL(URL): boolean {
  const str = URL;
  const Expression = /^(https?:\/\/)([0-9a-z.]+)(:[0-9]+)?([/0-9a-z.]+)?(\?[0-9a-z&=]+)?(#[0-9-a-z]+)?/i;
  if (Expression.test(str) == true) {
    return true;
  }
  return false;
}

/**
 * 输出日志
 */
window.api.outputLog(async (_event, msg: string, flgAppend = false, flgHtml = false) => {
  outputLog(msg, flgAppend, flgHtml);
});
async function outputLog(msg: string, flgAppend = false, flgHtml = false) {
  if (flgAppend) {
    logArr.push({ msg, flgHtml });
  } else {
    logArr.length = 0;
    logArr.push({ msg, flgHtml });
  }
  await setScrollToBottom();
}
/**
 * 控制滚动条滚动到容器的底部
 */
async function setScrollToBottom() {
  // 注意：需要通过 nextTick 以等待 DOM 更新完成
  await nextTick();
  const max = innerRef.value!.clientHeight;
  scrollbarRef.value!.setScrollTop(max);
}
/**
 * 批量下载完成
 */
window.api.downloadFnish(async () => {
  btnInfo.batchBtn = false;
});
</script>

<style scoped>
.tool-div-btn {
  min-width: 260px;
  margin-left: 10px;
}

.tool-div-btn .active {
  background-color: red;
}

.log-div {
  font-size: 14px;
}

.desc-div {
  font-size: 16px;
  /* text-align: center; */
  width: 60%;
  margin: 0px auto;
}

.desc-div p {
  margin: 15px 0px 0px 0px;
  word-break: break-all;
}

.el-main {
  --el-main-padding: 5px 20px 20px 20px;
}
</style>
