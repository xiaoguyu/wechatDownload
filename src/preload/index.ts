import { contextBridge, shell, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// Custom APIs for renderer
const api = {};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}

contextBridge.exposeInMainWorld('electronApi', {
  /*** render->main ***/
  // 以桌面的默认方式打开给定的文件
  openPath: (path: string) => shell.openPath(path),
  // 选择保存路径
  choseSavepath: () => {
    console.log(444);
  },
  // electron-store的api
  store: {
    get(key) {
      return ipcRenderer.sendSync('electron-store-get', key);
    },
    set(property, val) {
      ipcRenderer.send('electron-store-set', property, val);
    }
    // Other method you want to add like has(), reset(), etc.
  }
  /*** main->render ***/
});
