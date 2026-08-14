const db = require('../db');
const { expireDueUserOffers } = require('../utils/userOfferBalance');
const { getCurrencySymbolByCurrency } = require('../utils/countryCurrencyMap');

async function userHasCompletedOrder(userId) {
    const order = await db('orders')
        .where({ user_id: Number(userId), status: 'completed' })
        .whereNull('deleted_at')
        .first();
    return Boolean(order);
}

function getOfferBaseCurrency(scope) {
    const s = String(scope || '').toLowerCase().trim().replace(/[_\s]+/g, ' ');
    if (s === 'india') return 'INR';
    // out of india / out_of_india / etc → USD
    return 'USD';
}

async function getCurrencyRateMap() {
    const rows = await db('currency').select('currency_name', 'user_inr_rate');
    const map = {};
    for (const row of rows) {
        map[String(row.currency_name || '').toUpperCase()] = Number(row.user_inr_rate || 1) || 1;
    }
    if (!map.INR) map.INR = 1;
    return map;
}

/**
 * Offer amount → user display amount.
 * india scope = INR, out of india = USD.
 * Formula: amountInr = amount * baseRate; display = amountInr / userRate
 * e.g. 1 USD (rate 90), AED (rate 20) => 4.5
 */
function convertOfferAmount(amount, scope, userCurrency, rateMap) {
    const baseCurrency = getOfferBaseCurrency(scope);
    const userCur = String(userCurrency || 'INR').toUpperCase();
    const baseRate = Number(rateMap[baseCurrency] || 1) || 1;
    const userRate = Number(rateMap[userCur] || 1) || 1;

    const raw = Number(amount || 0);
    const amountInr = Number((raw * baseRate).toFixed(2));

    if (userCur === 'INR') {
        return {
            baseCurrency,
            amountInr,
            displayAmount: amountInr,
            currency: 'INR',
        };
    }

    return {
        baseCurrency,
        amountInr,
        displayAmount: Number((amountInr / userRate).toFixed(2)),
        currency: userCur,
    };
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

        const user = await db('users').select('default_currency').where({ id: userId }).first();
        const userCurrency = user?.default_currency || 'INR';
        const rateMap = await getCurrencyRateMap();
        const symbol = getCurrencySymbolByCurrency(userCurrency);

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
        const data = offers.map((offer) => {
            const converted = convertOfferAmount(offer.amount, offer.scope, userCurrency, rateMap);
            return {
                ...offer,
                amount: converted.displayAmount,
                base_amount: Number(offer.amount),
                base_currency: converted.baseCurrency,
                currency: symbol,
                currency_code: converted.currency,
            };
        });

        return res.status(200).json({
            success: true,
            data,
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

        const rawAmount = Number(offer.amount);
        if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
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

        const rateMap = await getCurrencyRateMap();

        const result = await db.transaction(async (trx) => {
            const user = await trx('users').where({ id: userId }).forUpdate().first();
            if (!user) throw new Error('USER_NOT_FOUND');

            const userCurrency = user.default_currency || 'INR';
            const converted = convertOfferAmount(rawAmount, offer.scope, userCurrency, rateMap);
            // users.balance always INR
            const creditInr = Number(converted.amountInr);

            const oldBalance = Number(user.balance || 0);
            const newBalance = Number((oldBalance + creditInr).toFixed(2));

            await trx('users').where({ id: userId }).update({ balance: newBalance });

            const [userOffer] = await trx('user_offers')
                .insert({
                    user_id: userId,
                    offer_id: offer.id,
                    amount: creditInr,
                    remaining_amount: creditInr,
                    expires_at: offer.end_at,
                    status: 'active',
                    currency: userCurrency,
                    created_at: new Date(),
                    updated_at: new Date(),
                })
                .returning('*');

            await trx('balancelogs').insert({
                user_id: userId,
                user_old_balance: oldBalance,
                user_new_balance: newBalance,
                amount: creditInr,
                message: `Offer applied (${offer.title})`,
                currency: userCurrency,
                type: 'offer',
                gst: 0,
            });

            return { userOffer, oldBalance, newBalance, offer, converted, userCurrency, creditInr };
        });

        const symbol = getCurrencySymbolByCurrency(result.userCurrency);
        return res.status(200).json({
            success: true,
            data: {
                user_offer_id: result.userOffer.id,
                offer_id: result.offer.id,
                title: result.offer.title,
                amount: result.converted.displayAmount,
                amount_inr: result.creditInr,
                base_amount: rawAmount,
                base_currency: result.converted.baseCurrency,
                remaining_amount: result.converted.displayAmount,
                expires_at: result.offer.end_at,
                balance: result.newBalance,
                currency: result.userCurrency,
                currency_symbol: symbol,
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
