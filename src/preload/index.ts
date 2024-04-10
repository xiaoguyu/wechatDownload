import { contextBridge, shell, ipcRenderer, OpenDialogOptions, MessageBoxOptions } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// Custom APIs for renderer
const api = {
  /*** render->main ***/
  // 安装证书
  installLicence: () => ipcRenderer.send('install-licence'),
  // 以桌面的默认方式打开给定的文件
  openPath: (path: string) => shell.openPath(path),
  // 打开日志文件的文件夹
  openLogsDir: () => ipcRenderer.send('open-logs-dir'),
  // 选择路径
  showOpenDialog: (options: OpenDialogOptions, callbackMsg: string) => ipcRenderer.send('show-open-dialog', options, callbackMsg),
  // 下载详情页数据
  downloadOne: (url: string) => ipcRenderer.send('download-one', url),
  // 开启公号文章监测（获取用户参数）
  monitorArticle: () => ipcRenderer.send('monitor-article'),
  // 开启公号文章监测（历史接口被封使用，获取文章地址）
  monitorLimitArticle: () => ipcRenderer.send('monitor-limit-article'),
  stopMonitorLimitArticle: () => ipcRenderer.send('stop-monitor-limit-article'),
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
  // 加载初始化数据
  loadInitInfo() {
    return ipcRenderer.sendSync('load-init-info');
  },
  // 检查更新
  checkForUpdate: () => ipcRenderer.send('check-for-update'),
  // 生成epub
  createEpub: (options: any) => ipcRenderer.send('create-epub', options),
  /*** main->render ***/
  // 用于打开文件夹之后接收打开的路径
  openDialogCallback: (callback) => ipcRenderer.on('open-dialog-callback', callback),
  // 输出日志
  outputLog: (callback) => ipcRenderer.on('output-log', callback),
  // 输出Epub日志
  outputEpubLog: (callback) => ipcRenderer.on('output-log', callback),
  // 下载完成
  downloadFnish: (callback) => ipcRenderer.on('download-fnish', callback),
  // 发送更新信息
  updateMsg: (callback) => ipcRenderer.on('update-msg', callback),
  // 发送下载进度
  downloadProgress: (callback) => ipcRenderer.on('download-progress', callback)
};

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
