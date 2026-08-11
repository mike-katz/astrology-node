const db = require('../db');

/**
 * Append an order lifecycle log. Never throws to callers (logs errors).
 */
async function addOrderLog(payload = {}, trxOrDb = null) {
    try {
        const client = trxOrDb || db;
        const row = {
            order_pk: payload.order_pk != null ? Number(payload.order_pk) : (payload.order?.id != null ? Number(payload.order.id) : null),
            order_id: payload.order_id || payload.order?.order_id || null,
            user_id: payload.user_id != null ? Number(payload.user_id) : (payload.order?.user_id != null ? Number(payload.order.user_id) : null),
            pandit_id: payload.pandit_id != null ? Number(payload.pandit_id) : (payload.order?.pandit_id != null ? Number(payload.order.pandit_id) : null),
            action: String(payload.action || 'updated'),
            status: payload.status != null ? String(payload.status) : (payload.order?.status != null ? String(payload.order.status) : null),
            message: payload.message || null,
            meta: payload.meta != null ? payload.meta : null,
            performed_by_type: payload.performed_by_type || null,
            performed_by_id: payload.performed_by_id != null ? Number(payload.performed_by_id) : null,
            place: payload.place || null,
            created_at: new Date(),
        };
        await client('order_logs').insert(row);
    } catch (err) {
        console.error('[order_logs] insert failed:', err?.message || err);
    }
}

module.exports = { addOrderLog };
