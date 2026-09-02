const db = require('../db');

const REFERRAL_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateReferralCode(length = 8) {
    let code = '';
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
    const code = String(referal_code || '').trim().toUpperCase();
    if (!code) {
        return { referal_code: ownCode, registered_referal: '', balance: 0 };
    }

    const alreadyUsed = await db('users')
        .where({ mobile, country_code })
        .whereNot('registered_referal', '')
        .first();
    if (alreadyUsed) {
        return { referal_code: ownCode, registered_referal: '', balance: 0 };
    }

    const referrer = await db('users')
        .whereRaw("UPPER(TRIM(referal_code)) = ?", [code])
        .whereNot('referal_code', '')
        .where(function () {
            this.whereNot({ mobile, country_code }).orWhereNull('mobile');
        })
        .first();
    if (!referrer) {
        return { referal_code: ownCode, registered_referal: '', balance: 0 };
    }

    return {
        referal_code: ownCode,
        registered_referal: referrer.referal_code,
        balance: 25,
    };
}

module.exports = { createUniqueReferralCode, resolveSignupReferral };
