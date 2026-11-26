const db = require('../db');

/**
 * Add amount + gst to users.total_deposit (success payment callback).
 * @param {number} userId
 * @param {number|string} amount
 * @param {number|string} gst
 * @param {import('knex').Knex} [trx=db]
 * @returns {Promise<number>} added value
 */
async function addUserTotalDeposit(userId, amount, gst, trx = db) {
    const add = Number((Number(amount || 0) + Number(gst || 0)).toFixed(2));
    if (!userId || !Number.isFinite(add) || add === 0) return 0;
    await trx('users').where({ id: userId }).increment({ total_deposit: add });
    return add;
}

module.exports = {
    addUserTotalDeposit,
};
