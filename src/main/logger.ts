import logger from 'electron-log';

// logger.transports.file.level = 'debug';
logger.transports.file.level = 'info';
logger.transports.file.maxSize = 1002430; // 10M
logger.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}';
const date = new Date();
const fileName = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate() + '.log';
logger.transports.file.fileName = fileName;

export default {
  info(...params: any[]) {
    logger.info(params);
  },
  warn(...params: any[]) {
    logger.warn(params);
  },
  error(...params: any[]) {
    logger.error(params);
  },
  debug(...params: any[]) {
    logger.debug(params);
  },
  verbose(...params: any[]) {
    logger.verbose(params);
  },
  silly(...params: any[]) {
    logger.silly(params);
  }
};
