const db = require('../db');

const DEFAULT_SLABS = [
    { min: 500, max: 1000, multiplier: 1.2 },
    { min: 1000, max: 5000, multiplier: 1.5 },
    { min: 5000, max: 10000, multiplier: 2 },
];

function parseSlabs(raw) {
    let slabs = raw;
    if (typeof slabs === 'string') {
        try {
            slabs = JSON.parse(slabs);
        } catch (_) {
            return DEFAULT_SLABS;
        }
    }
    if (!Array.isArray(slabs) || slabs.length === 0) return DEFAULT_SLABS;
    return slabs
        .map((s) => ({
            min: Number(s?.min),
            max: Number(s?.max),
            multiplier: Number(s?.multiplier),
        }))
        .filter((s) => Number.isFinite(s.min) && Number.isFinite(s.max) && Number.isFinite(s.multiplier) && s.multiplier > 0)
        .sort((a, b) => a.min - b.min || a.max - b.max);
}

function getUserRateMultiplier(userOrValue) {
    const value = userOrValue && typeof userOrValue === 'object'
        ? userOrValue.rate_multiplier
        : userOrValue;
    const m = Number(value == null ? 1 : value);
    return Number.isFinite(m) && m > 0 ? m : 1;
}

function applyRateMultiplier(amount, multiplier) {
    const m = getUserRateMultiplier(multiplier);
    return Number((Number(amount || 0) * m).toFixed(2));
}

/** Pick highest matching slab multiplier for an INR recharge amount. */
function getMultiplierForRechargeAmount(amountInr, slabsInput) {
    const amount = Number(amountInr || 0);
    if (!Number.isFinite(amount) || amount <= 0) return 1;
    const slabs = parseSlabs(slabsInput);
    let best = 1;
    for (const slab of slabs) {
        if (amount >= slab.min && amount <= slab.max) {
            best = Math.max(best, slab.multiplier);
        }
    }
    return best;
}

/**
 * Upgrade user rate_multiplier from recharge amount (INR). Never decreases.
 * @returns {Promise<number>} final multiplier
 */
async function upgradeUserRateMultiplier(userId, rechargeAmountInr, trx = db) {
    const settings = await trx('settings').select('rate_multiplier_slabs').first();
    const next = getMultiplierForRechargeAmount(rechargeAmountInr, settings?.rate_multiplier_slabs);
    const user = await trx('users').where({ id: userId }).select('id', 'rate_multiplier').first();
    if (!user) return next;
    const current = getUserRateMultiplier(user);
    const finalMultiplier = Math.max(current, next);
    if (finalMultiplier !== current) {
        await trx('users').where({ id: userId }).update({ rate_multiplier: finalMultiplier });
    }
    return finalMultiplier;
}

module.exports = {
    DEFAULT_SLABS,
    parseSlabs,
    getUserRateMultiplier,
    applyRateMultiplier,
    getMultiplierForRechargeAmount,
    upgradeUserRateMultiplier,
};
