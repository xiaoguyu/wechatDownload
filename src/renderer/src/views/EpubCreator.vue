<template>
  <el-container style="height: 100%">
    <el-header height="225px">
      <el-form :model="formData" label-width="auto">
        <el-form-item label="文件名">
          <el-input v-model="formData.title" placeholder="请填写Epub文件名" />
        </el-form-item>
        <el-form-item label="文件夹">
          <el-input v-model="formData.epubDataPath" placeholder="请选择数据来源文件夹" readonly>
            <template #append>
              <el-button @click="choseEpubDataPath">选择</el-button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="封面图片">
          <el-input v-model="formData.epubCover" placeholder="请选择Epub封面图片，非必填" readonly>
            <template #append>
              <el-button @click="choseCover">选择</el-button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item class="form-btn">
          <el-button type="primary" size="large" @click="onSubmit">生成</el-button>
        </el-form-item>
      </el-form>
    </el-header>
    <el-main>
      <el-scrollbar v-if="epubLogArr.length > 0" style="word-wrap: break-word">
        <div>
          <div v-for="(logItem, i) in epubLogArr" :key="i">
            <p v-if="logItem.flgHtml" v-html="logItem.msg"></p>
            <p v-else>{{ logItem.msg }}</p>
          </div>
        </div>
      </el-scrollbar>
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { OpenDialogOptions } from 'electron';
import { ElScrollbar } from 'element-plus';
import { reactive } from 'vue';

class LogInfo {
  msg: string;
  flgHtml: boolean;

  constructor(msg: string, flgHtml: boolean) {
    this.msg = msg;
    this.flgHtml = flgHtml;
  }
}
const epubLogArr = reactive([] as LogInfo[]);

const formData = reactive({
  title: '',
  epubDataPath: '',
  epubCover: ''
});

const onSubmit = () => {
  if (!formData.title || formData.title.length <= 0) {
    ElMessage.error('请填写文件名');
    return;
  }
  if (!formData.epubDataPath || formData.epubDataPath.length <= 0) {
    ElMessage.error('请选择文件夹');
    return;
  }
  window.api.createEpub(Object.assign({}, formData));
};
/**
 * 选择文件夹
 */
function choseEpubDataPath() {
  const options: OpenDialogOptions = {
    title: '请选择文件夹',
    properties: ['openDirectory']
  };
  window.api.showOpenDialog(options, 'epubDataPath');
}
/**
 * 选择封面图片
 */
function choseCover() {
  const options: OpenDialogOptions = {
    title: '请选择图片',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
  };
  window.api.showOpenDialog(options, 'epubCover');
}
/**
 * 选择文件夹、图片的回调
 */
window.api.openDialogCallback(async (_event, callbackMsg: string, pathStr: string) => {
  formData[callbackMsg] = pathStr;
});
/**
 * 输出日志
 */
window.api.outputEpubLog(async (_event, msg: string, flgAppend = false, flgHtml = false) => {
  outputLog(msg, flgAppend, flgHtml);
});
async function outputLog(msg: string, flgAppend = false, flgHtml = false) {
  if (flgAppend) {
    epubLogArr.push({ msg, flgHtml });
  } else {
    epubLogArr.length = 0;
    epubLogArr.push({ msg, flgHtml });
  }
}
</script>

<style scoped>
.el-main {
  --el-main-padding: 5px 20px 20px 20px;
}

:deep(.form-btn .el-form-item__content) {
  justify-content: center;
}
</style>
