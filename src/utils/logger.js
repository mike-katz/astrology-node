const log4jsSetting = {
    log4js: {
        logConfig: {
            appenders: {
                fileAppender: {
                    type: 'file',
                    filename: '../User_Node_logs/api.log',
                    mode: 0o644,
                    pattern: '-yyy-MM-dd',
                    layout: {
                        type: 'pattern', pattern: '%d [%p] - %c:%l - %m',
                    },
                },
                consoleAppender: {
                    type: 'console',
                    layout: {
                        type: 'pattern', pattern: '%d [%p] - %c:%l - %m',
                    },
                },
            },
            categories: {
                default: {
                    appenders: ['fileAppender', 'consoleAppender'], level: 'info', enableCallStack: true,
                },
            },
        },
    },
};

module.exports = log4jsSetting;
