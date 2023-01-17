import { OpenDialogOptions } from 'electron';

let HTML_ElE;
export function init(): void {
  window.addEventListener('DOMContentLoaded', () => {
    HTML_ElE = document.querySelector('html');

    // 添加下载按钮事件
    addDlOneEvent();
    // 添加批量下载按钮事件
    addDlBatchEvent();
    // 初始化设置中心的表单
    initSetting();
    // 添加导航菜单切换事件绑定
    addMenuEvent();
    // 设置中心事件绑定
    addSettingEvent();
    // 打开证书路径事件绑定
    addOpenLicenceEvent();
    // 选择保存路径
    addChoseSavePathEvent();
    // 选择缓存路径
    addChoseTmpPathEvent();
    // 添加测试mysql连接事件
    addTestConnectEvent();
    // main -> render的事件
    addCallbackEvent();
  });
}
/*
 * 添加下载按钮事件
 */
async function addDlOneEvent() {
  const dlOneEle = document.getElementById('dlOne');
  const urlInputEle = <HTMLInputElement>document.getElementById('url-input');
  if (dlOneEle && urlInputEle) {
    dlOneEle.onclick = () => {
      const url = urlInputEle.value;
      const checkResult = checkURL(url);
      if (!checkResult) {
        alert('请输入正确的url');
        return;
      }
      // 下载详情页数据
      window.electronApi.downloadOne(url);
    };
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

/*
 * 添加批量下载按钮事件
 */
async function addDlBatchEvent() {
  const dlBatchEle = document.getElementById('dlBatch');
  if (dlBatchEle) {
    dlBatchEle.onclick = () => {
      window.electronApi.monitorArticle();
      dlBatchEle.style.display = 'none';
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

    if (defaultVal) {
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
      if (inputEle.name == 'dlMysql' && defaultVal == 1) {
        const mysqlOptDiv = document.querySelector<HTMLInputElement>('.mysql-option');
        if (mysqlOptDiv) {
          mysqlOptDiv.style.display = 'block';
        }
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
        // mysql的配置框处理
        if (inputEle.name == 'dlMysql') {
          const mysqlOptDiv = document.querySelector<HTMLInputElement>('.mysql-option');
          if (mysqlOptDiv) {
            inputEle.checked ? (mysqlOptDiv.style.display = 'block') : (mysqlOptDiv.style.display = 'none');
          }
        }
      } else {
        storeSet(inputEle.name, inputEle.value);
      }
    };
  });
}

/*
 * 打开证书路径事件
 */
async function addOpenLicenceEvent() {
  const openLicenceButton = document.getElementById('open-licence');
  if (openLicenceButton) {
    openLicenceButton.onclick = () => {
      window.electronApi.openPath(storeGet('caPath'));
    };
  }
}
/*
 * 选择保存路径事件
 */
async function addChoseSavePathEvent() {
  const choseSavePathEle = document.getElementById('choseSavePath');
  if (choseSavePathEle) {
    choseSavePathEle.onclick = () => {
      const options: OpenDialogOptions = {
        title: '请选择保存路径',
        defaultPath: storeGet('savePath'),
        properties: ['openDirectory']
      };
      window.electronApi.showOpenDialog(options, 'savePath');
    };
  }
}
/*
 * 选择缓存路径事件
 */
async function addChoseTmpPathEvent() {
  const choseSavePathEle = document.getElementById('choseTmpPath');
  if (choseSavePathEle) {
    choseSavePathEle.onclick = () => {
      const options: OpenDialogOptions = {
        title: '请选择缓存路径',
        defaultPath: storeGet('tmpPath'),
        properties: ['openDirectory']
      };
      window.electronApi.showOpenDialog(options, 'tmpPath');
    };
  }
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
  window.electronApi.outputLog((_event, msg: string, flgAppend = false, flgHtml = false) => {
    outputLog(msg, flgAppend, flgHtml);
  });
  // 确认选择的公号文章是否正确
  window.electronApi.confirmTitle(async (_event, title) => {
    const infoMsg = `确认批量下载【${title}】所属公号的文章吗？`;
    if (window.confirm(infoMsg)) {
      window.electronApi.confirmDownload(true);
    } else {
      window.electronApi.confirmDownload(false);
    }
  });
  // alert
  window.electronApi.alert(async (_event, msg) => {
    window.alert(msg);
  });
  // 下载完成
  window.electronApi.downloadFnish(async () => {
    const dlBatchEle = document.getElementById('dlBatch');
    if (dlBatchEle) {
      dlBatchEle.style.display = 'inline-block';
    }
  });
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
async function outputLog(msg: string, flgAppend = false, flgHtml = false) {
  const logDivEle = <HTMLElement>document.getElementById('log-div');
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
