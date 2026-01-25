const db = require('../db');
require('dotenv').config();

// Get payments list for support ticket (when type is payment)
async function getPaymentsForTicket(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 100;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;

        const payments = await db('payments')
            .whereNull('deleted_at')
            .andWhere('user_id', req.userId)
            .orderBy('id', 'desc')
            .limit(limit)
            .offset(offset);

        // Get orders related to each payment (if any)
        const paymentsWithOrders = await Promise.all(
            payments.map(async (payment) => {
                // Get orders that might be related to this payment
                // Since payments and orders don't have direct foreign key, we'll get orders around the payment time
                const orders = await db('orders')
                    .where('user_id', req.userId)
                    .whereNull('deleted_at')
                    .whereBetween('created_at', [
                        new Date(new Date(payment.created_at).getTime() - 24 * 60 * 60 * 1000), // 24 hours before
                        new Date(new Date(payment.created_at).getTime() + 24 * 60 * 60 * 1000)  // 24 hours after
                    ])
                    .leftJoin('pandits as p', 'p.id', 'orders.pandit_id')
                    .select(
                        'orders.*',
                        'p.display_name as pandit_name',
                        'p.profile as pandit_profile'
                    )
                    .orderBy('orders.created_at', 'desc');

                return {
                    ...payment,
                    related_orders: orders
                };
            })
        );

        const [{ count }] = await db('payments')
            .count('* as count')
            .whereNull('deleted_at')
            .andWhere('user_id', req.userId);

        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: paymentsWithOrders
        };

        return res.status(200).json({
            success: true,
            data: response,
            message: 'Payments list fetched successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

// Get orders for a specific payment
async function getOrdersForPayment(req, res) {
    try {
        const { payment_id } = req.query;
        if (!payment_id) {
            return res.status(400).json({ success: false, message: 'Payment ID required' });
        }

        // Verify payment belongs to user
        const payment = await db('payments')
            .where({ id: payment_id, user_id: req.userId })
            .whereNull('deleted_at')
            .first();

        if (!payment) {
            return res.status(400).json({ success: false, message: 'Payment not found' });
        }

        // Get orders around the payment time
        const orders = await db('orders')
            .where('user_id', req.userId)
            .whereNull('deleted_at')
            .whereBetween('created_at', [
                new Date(new Date(payment.created_at).getTime() - 24 * 60 * 60 * 1000),
                new Date(new Date(payment.created_at).getTime() + 24 * 60 * 60 * 1000)
            ])
            .leftJoin('pandits as p', 'p.id', 'orders.pandit_id')
            .select(
                'orders.*',
                'p.display_name as pandit_name',
                'p.profile as pandit_profile'
            )
            .orderBy('orders.created_at', 'desc');

        return res.status(200).json({
            success: true,
            data: { payment, orders },
            message: 'Orders fetched successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

// Create support ticket
async function createTicket(req, res) {
    try {
        const { type, order_id, payment_id, message, issue_type } = req.body;

        // Validation
        if (!type || !message || !issue_type) {
            return res.status(400).json({
                success: false,
                message: 'Missing params'
            });
        }

        if (!['payment', 'call', 'chat'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Type must be payment, call, or chat'
            });
        }

        // If type is payment, payment_id should be provided
        if (type === 'payment' && !payment_id) {
            return res.status(400).json({
                success: false,
                message: 'Payment ID is required for payment type tickets'
            });
        }

        // If type is call or chat, order_id should be provided
        if ((type === 'call' || type === 'chat') && !order_id) {
            return res.status(400).json({
                success: false,
                message: 'Order ID is required for call/chat type tickets'
            });
        }

        // Verify payment belongs to user (if payment_id provided)
        if (payment_id) {
            const payment = await db('payments')
                .where({ id: payment_id, user_id: req.userId })
                .whereNull('deleted_at')
                .first();

            if (!payment) {
                return res.status(400).json({
                    success: false,
                    message: 'Payment not found'
                });
            }
        }

        // Verify order belongs to user (if order_id provided)
        let orderDbId = null;
        if (order_id) {
            const order = await db('orders')
                .where({ order_id: order_id, user_id: req.userId })
                .whereNull('deleted_at')
                .first();

            if (!order) {
                return res.status(400).json({
                    success: false,
                    message: 'Order not found'
                });
            }
            orderDbId = order.id;
        }

        // Create ticket
        const [ticket] = await db('support_tickets').insert({
            user_id: req.userId,
            type,
            issue_type,
            order_id: orderDbId,
            payment_id: payment_id || null,
            status: 'open'
        }).returning('*');

        return res.status(200).json({
            success: true,
            data: ticket,
            message: 'Support ticket created successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

// List support tickets
async function listTickets(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;
        const { type, status } = req.query;

        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        const offset = (page - 1) * limit;

        const filter = { 'st.user_id': req.userId, 'st.deleted_at': null };

        if (type) {
            filter['st.type'] = type;
        }

        if (status) {
            filter['st.status'] = status;
        }

        const tickets = await db('support_tickets as st')
            .where(filter)
            .leftJoin('orders as o', 'o.id', 'st.order_id')
            .leftJoin('payments as p', 'p.id', 'st.payment_id')
            .leftJoin('pandits as pandit', 'pandit.id', 'o.pandit_id')
            .select(
                'st.*',
                'o.order_id as order_order_id',
                'o.status as order_status',
                'o.type as order_type',
                'p.transaction_id as payment_transaction_id',
                'p.amount as payment_amount',
                'p.status as payment_status',
                'pandit.display_name as pandit_name',
                'pandit.profile as pandit_profile'
            )
            .orderBy('st.id', 'desc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await db('support_tickets as st')
            .where(filter)
            .count('* as count');

        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: tickets
        };

        return res.status(200).json({
            success: true,
            data: response,
            message: 'Tickets list fetched successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

// Get single ticket details
async function getTicketDetail(req, res) {
    try {
        const { id } = req.params;

        const ticket = await db('support_tickets as st')
            .where({ 'st.id': id, 'st.user_id': req.userId })
            .whereNull('st.deleted_at')
            .leftJoin('orders as o', 'o.id', 'st.order_id')
            .leftJoin('payments as p', 'p.id', 'st.payment_id')
            .leftJoin('pandits as pandit', 'pandit.id', 'o.pandit_id')
            .select(
                'st.*',
                'o.order_id as order_order_id',
                'o.status as order_status',
                'o.type as order_type',
                'o.created_at as order_created_at',
                'p.transaction_id as payment_transaction_id',
                'p.amount as payment_amount',
                'p.status as payment_status',
                'p.created_at as payment_created_at',
                'pandit.display_name as pandit_name',
                'pandit.profile as pandit_profile'
            )
            .first();

        if (!ticket) {
            return res.status(400).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: ticket,
            message: 'Ticket details fetched successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

// Get support types list
async function getSupportTypes(req, res) {
    try {
        const supportTypes = await db('support_types')
            .whereNull('deleted_at')
            .orderBy('id', 'asc');

        return res.status(200).json({
            success: true,
            data: supportTypes,
            message: 'Support types fetched successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = {
    getPaymentsForTicket,
    getOrdersForPayment,
    createTicket,
    listTickets,
    getTicketDetail,
    getSupportTypes
};
