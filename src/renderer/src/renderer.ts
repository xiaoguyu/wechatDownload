export function init(): void {
  window.addEventListener('DOMContentLoaded', () => {
    // 初始化设置中心的表单
    initSetting();
    // 添加导航菜单切换事件绑定
    addMenuEvent();
    // 设置中心事件绑定
    addSettingEvent();
    // 打开证书路径事件绑定
    addOpenLicenceEvent();
  });
}

/*
 * 初始化设置中心的表单
 */
function initSetting() {
  fillInput('.setting-contain .middle input');
  fillInput('.setting-contain .foot input');
}

function fillInput(selectPath: string) {
  document.querySelectorAll<HTMLInputElement>(selectPath).forEach((inputEle) => {
    const defaultVal = window.electronApi.store.get(inputEle.name);

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
    }
  });
}

/*
 * 添加导航菜单切换事件绑定
 */
function addMenuEvent() {
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
        console.log('containDiv', containDiv);
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
function addSettingEvent() {
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
    };
  });
}

function addOpenLicenceEvent() {
  const openLicenceButton = document.getElementById('open-licence');
  if (openLicenceButton) {
    openLicenceButton.onclick = () => {
      window.electronApi.openPath('D:\\');
    };
  }
}

// function storeGet(key: string): any {
//   window.electronApi.store.get(key);
// }

function storeSet(key: string, value: string | number): void {
  window.electronApi.store.set(key, value);
}

init();
