const db = require('../db');

/**
 * When user spends balance, reduce active offer remaining first (FIFO).
 * Call this whenever balance is deducted.
 */
async function consumeUserOfferRemaining(trxOrDb, userId, spentAmount) {
    let left = Number(spentAmount);
    if (!Number.isFinite(left) || left <= 0) return 0;

    const query = trxOrDb('user_offers')
        .where({ user_id: Number(userId), status: 'active' })
        .andWhere('remaining_amount', '>', 0)
        .orderBy('expires_at', 'asc')
        .orderBy('id', 'asc');

    const rows = typeof query.forUpdate === 'function'
        ? await query.forUpdate()
        : await query;

    let consumed = 0;
    for (const row of rows) {
        if (left <= 0) break;
        const remaining = Number(row.remaining_amount || 0);
        if (remaining <= 0) continue;

        const take = Math.min(remaining, left);
        const newRemaining = Number((remaining - take).toFixed(2));
        const patch = {
            remaining_amount: newRemaining,
            updated_at: new Date(),
        };
        if (newRemaining <= 0) {
            patch.status = 'exhausted';
            patch.remaining_amount = 0;
        }
        await trxOrDb('user_offers').where({ id: row.id }).update(patch);
        left -= take;
        consumed += take;
    }
    return consumed;
}

/**
 * Expire due offers: remove only leftover remaining_amount from balance.
 */
async function expireDueUserOffers() {
    const now = new Date();
    const due = await db('user_offers')
        .where({ status: 'active' })
        .andWhere('expires_at', '<=', now)
        .andWhere('remaining_amount', '>', 0)
        .orderBy('id', 'asc');

    let processed = 0;
    for (const row of due) {
        try {
            await db.transaction(async (trx) => {
                const locked = await trx('user_offers')
                    .where({ id: row.id, status: 'active' })
                    .forUpdate()
                    .first();
                if (!locked) return;

                const remaining = Number(locked.remaining_amount || 0);
                if (remaining <= 0) {
                    await trx('user_offers').where({ id: locked.id }).update({
                        status: 'exhausted',
                        remaining_amount: 0,
                        updated_at: new Date(),
                    });
                    return;
                }

                const user = await trx('users').where({ id: locked.user_id }).forUpdate().first();
                if (!user) {
                    await trx('user_offers').where({ id: locked.id }).update({
                        status: 'expired',
                        remaining_amount: 0,
                        updated_at: new Date(),
                    });
                    return;
                }

                const remove = Math.min(remaining, Number(user.balance || 0));
                const newBalance = Number((Number(user.balance || 0) - remove).toFixed(2));

                await trx('users').where({ id: user.id }).update({ balance: newBalance });
                await trx('balancelogs').insert({
                    user_id: user.id,
                    user_old_balance: Number(user.balance || 0),
                    user_new_balance: newBalance,
                    amount: -remove,
                    message: `Offer expired (offer_id=${locked.offer_id}, user_offer_id=${locked.id})`,
                    currency: user.default_currency || 'INR',
                    type: 'offer_expire',
                    gst: 0,
                });
                await trx('user_offers').where({ id: locked.id }).update({
                    status: 'expired',
                    remaining_amount: 0,
                    updated_at: new Date(),
                });
            });
            processed += 1;
        } catch (err) {
            console.error(`[ExpireOffer] user_offer id=${row.id}:`, err?.message || err);
        }
    }
    return { due: due.length, processed };
}

module.exports = {
    consumeUserOfferRemaining,
    expireDueUserOffers,
};
