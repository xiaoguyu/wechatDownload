import { ElectronAPI } from '@electron-toolkit/preload';

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      /*** render->main ***/
      // 安装证书
      installLicence();
      // 以桌面的默认方式打开给定的文件
      openPath(path: string): Promise<string>;
      // 打开日志文件的文件夹
      openLogsDir();
      // 选择路径
      showOpenDialog(options: OpenDialogOptions, callbackMsg: string);
      // 下载详情页数据
      downloadOne(url: string);
      // 开启公号文章监测（获取用户参数）
      monitorArticle();
      // 开启公号文章监测（历史接口被封使用，获取文章地址）
      monitorLimitArticle();
      stopMonitorLimitArticle();
      // 测试mysql连接
      testConnect();
      // 消息弹框
      showMessageBox(options: MessageBoxOptions);
      // electron-store的api
      store: {
        get: (key: string) => any;
        set: (key: string, val: any) => void;
        // any other methods you've defined...
      };
      // 加载初始化数据
      loadInitInfo: () => string;
      // 检查更新
      checkForUpdate();
      // 生成epub
      createEpub(options: any);

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
      //  输出日志到生成Epub页面
      outputEpubLog(callback: (event: IpcRendererEvent, msg: string, flgAppend = false, flgHtml = false) => void);
      // 下载完成后做的处理
      downloadFnish(callback: (event: IpcRendererEvent) => void);
      /*
       * 发送更新信息
       * msg：输出的消息
       */
      updateMsg(callback: (event: IpcRendererEvent, msg: any) => void);
      /*
       * 发送下载进度
       */
      downloadProgress(callback: (event: IpcRendererEvent, msg: ProgressInfo) => void);
    };
  }
}
