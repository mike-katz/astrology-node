const db = require('../db');

/**
 * per_order: every completed order adds rule.coin.
 * orders_in_hours: when order_count completed orders fall inside within_hours,
 * add rule.coin once for that window.
 */
async function awardPanditOrderCoins({ panditId, orderId, completedAt }) {
    const pandit_id = Number(panditId);
    const order_id = Number(orderId);
    if (!pandit_id || !order_id) return;

    const at = completedAt ? new Date(completedAt) : new Date();
    const rules = await db('pandit_coin_tasks')
        .where({ status: true })
        .whereNull('deleted_at')
        .whereIn('type', ['per_order', 'orders_in_hours']);

    for (const rule of rules) {
        const coins = Number(rule.coin) || 0;
        if (coins <= 0) continue;

        if (rule.type === 'per_order') {
            await grantOnce(pandit_id, rule.id, order_id, coins, async () => true);
            continue;
        }

        const hours = Number(rule.within_hours);
        const need = Number(rule.order_count);
        if (!hours || !need) continue;
        const since = new Date(at.getTime() - (hours * 60 * 60 * 1000));
        await grantOnce(pandit_id, rule.id, order_id, coins, async (trx) => {
            const recentGrant = await trx('pandit_coin_logs')
                .where({ task_id: rule.id, pandit_id })
                .where('created_at', '>=', since)
                .whereNot({ order_id })
                .first();
            if (recentGrant) return false;

            const countRow = await trx('orders')
                .where({ pandit_id, status: 'completed' })
                .where('end_time', '>=', since)
                .count('* as count')
                .first();
            return parseInt(countRow?.count || 0, 10) >= need;
        });
    }
}

async function grantOnce(panditId, taskId, orderId, coins, allow) {
    try {
        await db.transaction(async (trx) => {
            await trx('pandits').where({ id: panditId }).forUpdate().first();
            const already = await trx('pandit_coin_logs').where({ task_id: taskId, order_id: orderId }).first();
            if (already) return;
            const ok = await allow(trx);
            if (!ok) return;
            await trx('pandit_coin_logs').insert({
                pandit_id: panditId,
                task_id: taskId,
                order_id: orderId,
                coins,
            });
            await trx('pandits').where({ id: panditId }).update({
                coin: trx.raw('COALESCE(coin, 0) + ?', [coins]),
            });
        });
    } catch (err) {
        if (err?.code === '23505') return;
        throw err;
    }
}

module.exports = { awardPanditOrderCoins };
