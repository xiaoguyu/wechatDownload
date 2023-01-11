import { OpenDialogOptions } from 'electron';
import { ElectronAPI } from '@electron-toolkit/preload';

declare global {
  interface Window {
    electron: ElectronAPI;
    api: unknown;
    electronApi: {
      /*** render->main ***/
      // 以桌面的默认方式打开给定的文件
      openPath(path: string): Promise<string>;
      // 选择路径
      showOpenDialog(options: OpenDialogOptions, callbackMsg: string);
      // 下载详情页数据
      downloadOne(url: string);
      // 开启公号文章监测
      monitorArticle();
      // 确认是否批量下载
      confirmDownload(flgDownload: boolean);
      // electron-store的api
      store: {
        get: (key: string) => any;
        set: (key: string, val: any) => void;
        // any other methods you've defined...
      };

      /*** main->render ***/
      // 用于打开文件夹之后接收打开的路径
      openDialogCallback(callback: (event: IpcRendererEvent, callbackMsg: string, path: string) => void);
      /*
       * 输出日志到主页面
       * msg：输出的消息
       * append：是否追加
       * flgHtml：消息是否是html
       */
      outputLog(callback: (event: IpcRendererEvent, msg: string, flgAppend = false, flgHtml = false) => void);
      // 确认批量下载的公号文章的标题
      confirmTitle(callback: (event: IpcRendererEvent, title: string) => void);
      // 下载完成后做的处理
      downloadFnish(callback: (event: IpcRendererEvent) => void);
    };
  }
}
