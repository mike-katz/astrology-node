const log4js = require('log4js');
const path = require('path');
const fs = require('fs');

// Step 1: Folder nathi to pela folder create karo (project root par)
const logsDir = path.join(process.cwd(), '../User-Node_logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Step 2: Pachi j log file (log4js file appender) use karo
const log4jsSetting = {
    appenders: {
        fileAppender: {
            type: 'dateFile',
            filename: path.join(logsDir, 'api.log'),
            pattern: '.yyyy-MM-dd',
            keepFileExt: true,
            numBackups: 30,
            layout: {
                type: 'pattern',
                pattern: '%d [%p] - %c:%l - %m',
            },
        },
        consoleAppender: {
            type: 'console',
            layout: {
                type: 'pattern',
                pattern: '%d [%p] - %c:%l - %m',
            },
        },
    },
    categories: {
        default: {
            appenders: ['fileAppender', 'consoleAppender'],
            level: process.env.LOG_LEVEL || 'info',
            enableCallStack: true,
        },
    },
};

log4js.configure(log4jsSetting);

/**
 * Use: const logger = require('../utils/logger');
 *      logger.log('message') or logger.info('message');
 *      logger.error('err', err);
 * Or: const logger = require('../utils/logger').getLogger('authController');
 */
const defaultLogger = log4js.getLogger('app');

function wrapLogger(l) {
    return {
        log: (...args) => l.info(...args),
        trace: (...args) => l.trace(...args),
        debug: (...args) => l.debug(...args),
        info: (...args) => l.info(...args),
        warn: (...args) => l.warn(...args),
        error: (...args) => l.error(...args),
        fatal: (...args) => l.fatal(...args),
        getLogger: (name) => wrapLogger(log4js.getLogger(name || 'app')),
    };
}

module.exports = wrapLogger(defaultLogger);
