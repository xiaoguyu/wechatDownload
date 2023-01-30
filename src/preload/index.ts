import { contextBridge, shell, ipcRenderer, OpenDialogOptions, MessageBoxOptions } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// Custom APIs for renderer
const api = {};

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
  // 选择路径
  showOpenDialog: (options: OpenDialogOptions, callbackMsg: string) => ipcRenderer.send('show-open-dialog', options, callbackMsg),
  // 下载详情页数据
  downloadOne: (url: string) => ipcRenderer.send('download-one', url),
  // 开启公号文章监测
  monitorArticle: () => ipcRenderer.send('monitor-article'),
  // 测试mysql连接
  testConnect: () => ipcRenderer.send('test-connect'),
  // 消息弹框
  showMessageBox: (options: MessageBoxOptions) => ipcRenderer.send('show-message-box', options),
  // electron-store的api
  store: {
    get(key) {
      return ipcRenderer.sendSync('electron-store-get', key);
    },
    set(property, val) {
      ipcRenderer.send('electron-store-set', property, val);
    }
    // Other method you want to add like has(), reset(), etc.
  },
  /*** main->render ***/
  // 用于打开文件夹之后接收打开的路径
  openDialogCallback: (callback) => ipcRenderer.on('open-dialog-callback', callback),
  // 输出日志
  outputLog: (callback) => ipcRenderer.on('output-log', callback),
  // 下载完成
  downloadFnish: (callback) => ipcRenderer.on('download-fnish', callback)
});
