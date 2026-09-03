const db = require('../db');

const REFERRAL_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateReferralCode(length = 8) {
    let code = 'AG';
    for (let i = 0; i < length; i++) {
        code += REFERRAL_CHARS[Math.floor(Math.random() * REFERRAL_CHARS.length)];
    }
    return code;
}

async function createUniqueReferralCode() {
    for (let i = 0; i < 25; i++) {
        const code = generateReferralCode();
        const exists = await db('users').where({ referal_code: code }).first();
        if (!exists) return code;
    }
    return `AG${Date.now().toString(36).toUpperCase()}`;
}

async function resolveSignupReferral({ referal_code, mobile, country_code }) {
    const ownCode = await createUniqueReferralCode();
    const empty = { referal_code: ownCode, registered_referal: '', referrer: null };
    const code = String(referal_code || '').trim().toUpperCase();
    if (!code) return empty;

    const alreadyUsed = await db('users')
        .where({ mobile, country_code })
        .whereNot('registered_referal', '')
        .first();
    if (alreadyUsed) return empty;

    const referrer = await db('users')
        .whereRaw("UPPER(TRIM(referal_code)) = ?", [code])
        .whereNot('referal_code', '')
        .first();
    if (!referrer) return empty;
    if (referrer.mobile === mobile && referrer.country_code === country_code) return empty;

    return {
        referal_code: ownCode,
        registered_referal: referrer.referal_code,
        referrer,
    };
}

async function creditReferrerBonus(referrer) {
    if (!referrer?.id) return;

    const userCurrency = referrer.default_currency || 'INR';
    const bonus = await db('referral_bonuses')
        .whereRaw('UPPER(TRIM(currency)) = ?', [String(userCurrency).toUpperCase()])
        .whereNull('deleted_at')
        .first();
    if (!bonus) return;

    const bonusAmount = Number(bonus.amount);
    if (!Number.isFinite(bonusAmount) || bonusAmount <= 0) return;

    const currencyData = await db('currency')
        .where({ currency_name: userCurrency })
        .first();
    const credit = Number((bonusAmount * Number(currencyData?.user_inr_rate || 1)).toFixed(2));
    if (!Number.isFinite(credit) || credit <= 0) return;

    const oldBalance = Number(referrer.balance || 0);
    const newBalance = oldBalance + credit;
    await db('users').where({ id: referrer.id }).increment({ balance: credit });
    await db('balancelogs').insert({
        user_id: referrer.id,
        user_old_balance: oldBalance,
        user_new_balance: newBalance,
        amount: credit,
        message: 'Referral bonus',
        currency: userCurrency,
        type: 'referral',
        gst: 0,
    });
}

module.exports = { createUniqueReferralCode, resolveSignupReferral, creditReferrerBonus };
