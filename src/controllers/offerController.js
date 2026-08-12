const db = require('../db');
const { expireDueUserOffers } = require('../utils/userOfferBalance');

async function userHasCompletedOrder(userId) {
    const order = await db('orders')
        .where({ user_id: Number(userId), status: 'completed' })
        .whereNull('deleted_at')
        .first();
    return Boolean(order);
}

async function getOfferList(req, res) {
    try {
        const userId = Number(req.userId);
        const hasCompletedOrder = await userHasCompletedOrder(userId);
        if (!hasCompletedOrder) {
            return res.status(200).json({
                success: true,
                data: [],
                message: 'Offers available only after at least 1 completed order.',
            });
        }

        const usedOfferIds = await db('user_offers')
            .where({ user_id: userId })
            .pluck('offer_id');

        const now = new Date();
        let query = db('offers')
            .where({ status: true })
            .whereNull('deleted_at')
            .andWhere('start_at', '<=', now)
            .andWhere('end_at', '>=', now);

        if (usedOfferIds.length > 0) {
            query = query.whereNotIn('id', usedOfferIds);
        }

        const offers = await query.orderBy('id', 'desc');

        return res.status(200).json({
            success: true,
            data: offers,
            message: 'Offer list fetched successfully',
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function applyOffer(req, res) {
    try {
        const userId = Number(req.userId);
        const offerId = Number(req.body?.offer_id || req.query?.offer_id);
        if (!offerId) {
            return res.status(400).json({ success: false, message: 'offer_id is required.' });
        }

        const hasCompletedOrder = await userHasCompletedOrder(userId);
        if (!hasCompletedOrder) {
            return res.status(400).json({
                success: false,
                message: 'Offers available only after at least 1 completed order.',
            });
        }

        const now = new Date();
        const offer = await db('offers')
            .where({ id: offerId, status: true })
            .whereNull('deleted_at')
            .andWhere('start_at', '<=', now)
            .andWhere('end_at', '>=', now)
            .first();

        if (!offer) {
            return res.status(400).json({ success: false, message: 'Invalid or expired offer.' });
        }

        const amount = Number(offer.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid offer amount.' });
        }

        const already = await db('user_offers')
            .where({ user_id: userId, offer_id: offerId })
            .whereIn('status', ['active', 'exhausted', 'expired'])
            .first();
        if (already) {
            return res.status(400).json({ success: false, message: 'Offer already applied.' });
        }

        const activeOffer = await db('user_offers')
            .where({ user_id: userId, status: 'active' })
            .andWhere('remaining_amount', '>', 0)
            .first();
        if (activeOffer) {
            return res.status(400).json({
                success: false,
                message: 'Please use your current offer balance before applying another.',
            });
        }

        const result = await db.transaction(async (trx) => {
            const user = await trx('users').where({ id: userId }).forUpdate().first();
            if (!user) throw new Error('USER_NOT_FOUND');

            const oldBalance = Number(user.balance || 0);
            const newBalance = Number((oldBalance + amount).toFixed(2));

            await trx('users').where({ id: userId }).update({ balance: newBalance });

            const [userOffer] = await trx('user_offers')
                .insert({
                    user_id: userId,
                    offer_id: offer.id,
                    amount,
                    remaining_amount: amount,
                    expires_at: offer.end_at,
                    status: 'active',
                    created_at: new Date(),
                    updated_at: new Date(),
                })
                .returning('*');

            await trx('balancelogs').insert({
                user_id: userId,
                user_old_balance: oldBalance,
                user_new_balance: newBalance,
                amount,
                message: `Offer applied (${offer.title})`,
                currency: user.default_currency || 'INR',
                type: 'offer',
                gst: 0,
            });

            return { userOffer, oldBalance, newBalance, offer };
        });

        return res.status(200).json({
            success: true,
            data: {
                user_offer_id: result.userOffer.id,
                offer_id: result.offer.id,
                title: result.offer.title,
                amount,
                remaining_amount: amount,
                expires_at: result.offer.end_at,
                balance: result.newBalance,
            },
            message: 'Offer applied successfully',
        });
    } catch (err) {
        if (err?.message === 'USER_NOT_FOUND') {
            return res.status(400).json({ success: false, message: 'User not found.' });
        }
        // unique violation
        if (err?.code === '23505') {
            return res.status(400).json({ success: false, message: 'Offer already applied.' });
        }
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getOfferList, applyOffer, expireDueUserOffers };
