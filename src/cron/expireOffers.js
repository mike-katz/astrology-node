const cron = require('node-cron');
const { expireDueUserOffers } = require('../utils/userOfferBalance');

const runExpireOffersCron = async () => {
    try {
        console.log('[ExpireOfferCron] start', new Date().toISOString());
        const result = await expireDueUserOffers();
        console.log(`[ExpireOfferCron] done. due=${result.due}, processed=${result.processed}`);
    } catch (err) {
        console.error('[ExpireOfferCron] error:', err?.message || err);
    }
};

// Daily at 12:00 AM IST
cron.schedule('0 0 * * *', () => {
    runExpireOffersCron();
}, {
    timezone: 'Asia/Kolkata',
});

console.log('[ExpireOfferCron] scheduled daily at 12:00 AM IST (Asia/Kolkata)');
