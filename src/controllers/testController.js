const db = require('../db');

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomPick = (arr) => arr[randomInt(0, arr.length - 1)];
const randomStr = (len = 8) => Math.random().toString(36).slice(2, 2 + len);

/** GET /test/seed-users?count=10 - Create users with random data (for loop) */
async function seedUsers(req, res) {
    try {
        const count = Math.min(parseInt(req.query.count) || 10, 1000);
        console.log("count", count);
        const inserted = [];
        for (let i = 0; i < count; i++) {
            const [row] = await db('users').insert({
                mobile: `9${randomInt(7000000000, 9999999999)}`,
                country_code: '+91',
                name: `User_${randomStr(6)}`,
                email: `test_${randomStr(8)}@test.com`,
                status: 'active',
                balance: 0,
                gender: randomPick(['male', 'female', 'other']),
            }).returning('*');
            inserted.push(row);
        }
        return res.status(200).json({ success: true, count: inserted.length, data: inserted });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/** GET /test/seed-orders?count=100 - Create orders with random data (uses existing users & pandits) */
async function seedOrders(req, res) {
    try {
        const count = Math.min(parseInt(req.query.count) || 100, 1000000);
        const userIds = await db('users').select('id').limit(500).then(rows => rows.map(r => r.id));
        const panditIds = await db('pandits').select('id').whereNull('deleted_at').limit(500).then(rows => rows.map(r => r.id));
        if (!userIds.length || !panditIds.length) {
            return res.status(400).json({ success: false, message: 'Need at least one user and one pandit in DB.' });
        }
        const statuses = ['pending', 'continue', 'complete', 'cancel'];
        const types = ['chat', 'call'];
        const inserted = [];
        for (let i = 0; i < count; i++) {
            const orderId = `${Date.now()}${randomInt(100000, 999999)}`;
            const [row] = await db('orders').insert({
                user_id: randomPick(userIds),
                pandit_id: randomPick(panditIds),
                order_id: orderId,
                status: randomPick(statuses),
                type: randomPick(types),
                rate: randomInt(1, 50),
                duration: randomInt(1, 60),
                deduction: 0,
                is_accept: Math.random() > 0.5,
                is_free: Math.random() > 0.7,
            }).returning('*');
            inserted.push(row);
        }
        return res.status(200).json({ success: true, count: inserted.length, data: inserted.slice(0, 10) });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/** GET /test/seed-chats?count=100 - Create chats with random data (uses existing orders) */
async function seedChats(req, res) {
    try {
        const count = Math.min(parseInt(req.query.count) || 100, 1000000);
        const orders = await db('orders').select('id', 'order_id', 'user_id', 'pandit_id').limit(1000);
        if (!orders.length) {
            return res.status(400).json({ success: false, message: 'Need at least one order in DB.' });
        }
        const messages = ['Hello', 'Namaste', 'Need guidance', 'Thanks', 'Okay', 'Yes', 'No', 'Please tell more', 'When?', 'Got it'];
        const inserted = [];
        for (let i = 0; i < count; i++) {
            const order = randomPick(orders);
            const isUserSender = Math.random() > 0.5;
            const [row] = await db('chats').insert({
                sender_id: isUserSender ? order.user_id : order.pandit_id,
                receiver_id: isUserSender ? order.pandit_id : order.user_id,
                sender_type: isUserSender ? 'user' : 'pandit',
                receiver_type: isUserSender ? 'pandit' : 'user',
                order_id: order.order_id,
                message: randomPick(messages) + ' ' + randomStr(4),
                status: 'send',
                type: 'text',
                is_system_generate: false,
            }).returning('*');
            inserted.push(row);
        }
        return res.status(200).json({ success: true, count: inserted.length, data: inserted.slice(0, 10) });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = { seedUsers, seedOrders, seedChats };
