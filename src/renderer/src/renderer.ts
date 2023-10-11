import { OpenDialogOptions } from 'electron';

let HTML_ElE;
export function init(): void {
  window.addEventListener('DOMContentLoaded', () => {
    HTML_ElE = document.querySelector('html');

    // 添加下载按钮事件
    addDlOneEvent();
    // 添加批量下载按钮事件
    addDlBatchEvent();
    // 添加监控下载按钮事件
    addDldlRestrictionsBatchEvent();
    // 初始化设置中心的表单
    initSetting();
    // 添加导航菜单切换事件绑定
    addMenuEvent();
    // 设置中心事件绑定
    addSettingEvent();
    // 安装证书事件绑定
    addInstallLicenceEvent();
    // 打开证书路径事件绑定
    addOpenLicenceEvent();
    // 检查更新事件绑定
    addCheckUpdateEvent();
    // 打开日志文件夹
    addOpenLogsDirEvent();
    // 选择保存路径
    addChoseSavePathEvent();
    // 选择缓存路径
    addChoseTmpPathEvent();
    // 添加测试mysql连接事件
    addTestConnectEvent();
    // main -> render的事件
    addCallbackEvent();
    // 加载初始化数据
    initInfo();
  });
}
/*
 * 添加下载按钮事件
 */
async function addDlOneEvent() {
  const dlOneEle = document.getElementById('dlOne');
  const urlInputEle = <HTMLInputElement>document.getElementById('url-input');
  dlOneEle!.onclick = () => {
    const url = urlInputEle.value;
    const checkResult = checkURL(url);
    if (!checkResult) {
      window.electronApi.showMessageBox({
        type: 'warning',
        message: '请输入正确的url'
      });
      return;
    }
    // 下载详情页数据
    window.electronApi.downloadOne(url);
  };
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

/*
 * 添加批量下载按钮事件
 */
async function addDlBatchEvent() {
  const dlBatchEle = document.getElementById('dlBatch');
  dlBatchEle!.onclick = () => {
    window.electronApi.monitorArticle();
    dlBatchEle!.style.display = 'none';
  };
}

async function addDldlRestrictionsBatchEvent() {
  const dlBatchEle = document.getElementById('dlBatch');
  const dlRestrictionsBatchEle = document.getElementById('dlRestrictionsBatch');
  if (dlRestrictionsBatchEle && dlBatchEle) {
    dlRestrictionsBatchEle.onclick = () => {
      // 按钮选中
      if (!dlRestrictionsBatchEle.classList.contains('b-clicked')) {
        dlRestrictionsBatchEle.classList.add('b-clicked');
        dlBatchEle.style.display = 'none';

        window.electronApi.monitorLimitArticle();
      } else {
        // 按钮取消
        dlRestrictionsBatchEle.classList.remove('b-clicked');
        dlBatchEle.style.display = 'inline-block';

        window.electronApi.stopMonitorLimitArticle();
      }
    };
  }
}

/*
 * 初始化设置中心的表单
 */
async function initSetting() {
  fillInput('.setting-contain .middle input');
  fillInput('.setting-contain .foot input');
}

async function fillInput(selectPath: string) {
  document.querySelectorAll<HTMLInputElement>(selectPath).forEach((inputEle) => {
    const defaultVal = storeGet(inputEle.name);

    if (defaultVal != null && defaultVal != undefined) {
      if (inputEle.type === 'checkbox') {
        if (defaultVal == 1) {
          inputEle.checked = true;
        }
      } else if (inputEle.type === 'radio') {
        if (inputEle.value == defaultVal) {
          inputEle.checked = true;
        }
      } else {
        inputEle.value = defaultVal;
      }

      // mysql配置框处理
      if ((inputEle.name == 'dlMysql' && defaultVal == 1) || (inputEle.name == 'dlSource' && defaultVal == 'db')) {
        const mysqlOptDiv = document.querySelector<HTMLInputElement>('.mysql-option');
        mysqlOptDiv!.style.display = 'block';
      } else if (inputEle.name == 'threadType' && inputEle.value == 'single' && inputEle.value == defaultVal) {
        // 线程配置
        const batchLimitSpan = document.querySelector<HTMLInputElement>('.batch-limit');
        batchLimitSpan!.style.display = 'none';
      }
    }
  });
}

/*
 * 添加导航菜单切换事件绑定
 */
async function addMenuEvent() {
  document.querySelectorAll('.menu-ul li').forEach((obj) => {
    const liEle = <HTMLElement>obj;
    liEle.onclick = () => {
      // 菜单栏样式切换
      document.querySelectorAll('.menu-ul li').forEach((liObj) => {
        const _liEle = <HTMLElement>liObj;
        if (_liEle === liEle) {
          _liEle.classList.add('active');
        } else {
          _liEle.classList.remove('active');
        }
      });
      // 内容div切换
      const containDivClass = liEle.getAttribute('value') || '';
      document.querySelectorAll('.contain .cselect').forEach((inObj) => {
        const containDiv = <HTMLElement>inObj;
        if (containDiv.classList.contains(containDivClass)) {
          containDiv.style.display = 'block';
        } else {
          containDiv.style.display = 'none';
        }
      });
    };
  });
}

/*
 * 设置中心事件绑定
 */
async function addSettingEvent() {
  addInputEvent('.setting-contain .middle input');
  addInputEvent('.setting-contain .foot .save-path input');
}

/*
 * 给input添加事件
 * selectPath：document.querySelectorAll的搜索参数
 */
function addInputEvent(selectPath: string) {
  document.querySelectorAll<HTMLInputElement>(selectPath).forEach((inputEle) => {
    inputEle.onchange = () => {
      if (inputEle.type === 'checkbox') {
        if (inputEle.checked) {
          storeSet(inputEle.name, 1);
        } else {
          storeSet(inputEle.name, 0);
        }
      } else {
        storeSet(inputEle.name, inputEle.value);
      }
      // mysql的配置框处理
      if (inputEle.name == 'dlMysql') {
        const mysqlOptDiv = document.querySelector<HTMLInputElement>('.mysql-option');
        if (inputEle.checked) {
          mysqlOptDiv!.style.display = 'block';
        } else {
          const dlSourceInput = document.querySelector<HTMLInputElement>('input[name=dlSource]:checked');
          if (dlSourceInput && dlSourceInput.value === 'db') {
            return;
          }
          mysqlOptDiv!.style.display = 'none';
        }
      } else if (inputEle.name == 'threadType') {
        // 线程配置处理
        const batchLimitSpan = document.querySelector<HTMLInputElement>('.batch-limit');
        if (inputEle.value == 'single') {
          batchLimitSpan!.style.display = 'none';
        } else {
          batchLimitSpan!.style.display = 'inline';
        }
      } else if (inputEle.name == 'dlSource') {
        // 下载来源处理
        const mysqlOptDiv = document.querySelector<HTMLInputElement>('.mysql-option');
        if (inputEle.checked && inputEle.value === 'db') {
          mysqlOptDiv!.style.display = 'block';
        } else {
          const dlMysqlInput = document.querySelector<HTMLInputElement>('input[name=dlMysql]');
          if (dlMysqlInput && dlMysqlInput.checked) {
            return;
          }
          mysqlOptDiv!.style.display = 'none';
        }
      }
    };
  });
}

/*
 * 安装证书路径事件
 */
async function addInstallLicenceEvent() {
  const installLicenceButton = document.getElementById('install-licence');
  installLicenceButton!.onclick = () => {
    window.electronApi.installLicence();
  };
}
/*
 * 打开证书路径事件
 */
async function addOpenLicenceEvent() {
  const openLicenceButton = document.getElementById('open-licence');
  openLicenceButton!.onclick = () => {
    window.electronApi.openPath(storeGet('caPath'));
  };
}
/*
 * 点击检查更新按钮事件
 */
async function addCheckUpdateEvent() {
  const checkUpdateButton = document.getElementById('check-update');
  checkUpdateButton!.onclick = () => {
    window.electronApi.checkForUpdate();
  };
}
/*
 * 打开日志文件夹
 */
async function addOpenLogsDirEvent() {
  const oepnLogsDirButton = document.getElementById('open-logs-dir');
  oepnLogsDirButton!.onclick = () => {
    window.electronApi.openLogsDir();
  };
}
/*
 * 选择保存路径事件
 */
async function addChoseSavePathEvent() {
  const choseSavePathEle = document.getElementById('choseSavePath');
  choseSavePathEle!.onclick = () => {
    const options: OpenDialogOptions = {
      title: '请选择保存路径',
      defaultPath: storeGet('savePath'),
      properties: ['openDirectory']
    };
    window.electronApi.showOpenDialog(options, 'savePath');
  };
}
/*
 * 选择缓存路径事件
 */
async function addChoseTmpPathEvent() {
  const choseSavePathEle = document.getElementById('choseTmpPath');
  choseSavePathEle!.onclick = () => {
    const options: OpenDialogOptions = {
      title: '请选择缓存路径',
      defaultPath: storeGet('tmpPath'),
      properties: ['openDirectory']
    };
    window.electronApi.showOpenDialog(options, 'tmpPath');
  };
}

/*
 * main -> render的事件
 */
async function addCallbackEvent() {
  // 选择路径后的回调
  window.electronApi.openDialogCallback(async (_event, callbackMsg: string, pathStr: string) => {
    const inputEle = <HTMLInputElement>document.getElementById(callbackMsg);
    if (inputEle) {
      inputEle.value = pathStr;
    }
  });
  // 输出日志
  window.electronApi.outputLog(async (_event, msg: string, flgAppend = false, flgHtml = false) => {
    outputLog(msg, flgAppend, flgHtml);
  });
  // 下载完成
  window.electronApi.downloadFnish(async () => {
    const dlBatchEle = document.getElementById('dlBatch');
    dlBatchEle!.style.display = 'inline-block';
  });
  // 接收更新信息
  window.electronApi.updateMsg(async (_event, msgObj: any) => {
    const updateMsgDivEle = document.getElementById('update-msg-div');
    if (msgObj.code == 3) {
      updateMsgDivEle!.style.display = 'none';
      const progressDivEle = document.getElementById('progress-div');
      if (progressDivEle) {
        progressDivEle.style.display = 'flex';
      }
    } else {
      updateMsgDivEle!.innerText = msgObj.msg;
    }
  });
  // 接收下载进度
  const numM = 1048576;
  window.electronApi.downloadProgress(async (_event, progressObj: any) => {
    const progressEle = <HTMLProgressElement>document.getElementById('update-progress');
    progressEle.value = progressObj.percent;
    const transferredEle = <HTMLProgressElement>document.getElementById('transferred-span');
    const totalM = (progressObj.total / numM).toFixed(2);
    const transferredM = (progressObj.transferred / numM).toFixed(2);
    transferredEle.innerText = `${transferredM}/${totalM}M`;
  });
}
/*
 * 加载初始化数据
 */
async function initInfo() {
  const versionStr: string = window.electronApi.loadInitInfo();
  const versionSpanEle = document.getElementById('version-span');
  versionSpanEle!.innerText = versionStr;
}
/*
 * 添加测试mysql连接事件
 */
async function addTestConnectEvent() {
  const testConnectEle = document.getElementById('test-connect');
  if (testConnectEle) {
    testConnectEle.onclick = () => {
      window.electronApi.testConnect();
    };
  }
}
/*
 * 输出日志到主页面
 * msg：输出的消息
 * append：是否追加
 * flgHtml：消息是否是html
 */
const logDivEle = <HTMLElement>document.getElementById('log-div');
async function outputLog(msg: string, flgAppend = false, flgHtml = false) {
  if (logDivEle) {
    if (flgAppend) {
      let ele;
      if (flgHtml) {
        const divEle = document.createElement('div');
        divEle.innerHTML = msg;
        ele = divEle.childNodes[0];
      } else {
        ele = document.createElement('p');
        ele.innerHTML = msg;
      }
      logDivEle.appendChild(ele);
    } else {
      if (flgHtml) {
        logDivEle.innerHTML = msg;
      } else {
        logDivEle.innerHTML = '<p>' + msg + '</p>';
      }
    }
  }
  if (HTML_ElE && HTML_ElE.scrollHeight > HTML_ElE.clientHeight) {
    //设置滚动条到最底部
    HTML_ElE.scrollTop = HTML_ElE.scrollHeight;
  }
}

function storeGet(key: string): any {
  return window.electronApi.store.get(key);
}

async function storeSet(key: string, value: string | number) {
  window.electronApi.store.set(key, value);
}

init();
