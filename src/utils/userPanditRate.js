const { convertCurrency, roundMoney } = require('./decodeJWT');
const { applyRateMultiplier, getUserRateMultiplier } = require('./rateMultiplier');

/**
 * Same rate user sees on pandit list/detail (user currency, 2 decimals).
 * Formula: convertCurrency(baseInr * multiplier, pandit_inr_rate)
 */
function getDisplayPanditRate(inrAmount, userOrMultiplier, panditInrRate) {
    return convertCurrency(
        applyRateMultiplier(inrAmount, getUserRateMultiplier(userOrMultiplier)),
        panditInrRate || 1
    );
}

/**
 * Wallet cut rate from the exact 2-decimal display rate.
 * displayRate * user_inr_rate (2 decimals) — never use unrounded intermediates.
 */
function getWalletPanditRate(inrAmount, userOrMultiplier, panditInrRate, userInrRate) {
    const displayRate = getDisplayPanditRate(inrAmount, userOrMultiplier, panditInrRate);
    return roundMoney(Number(displayRate) * Number(userInrRate || 1));
}

module.exports = {
    getDisplayPanditRate,
    getWalletPanditRate,
};
