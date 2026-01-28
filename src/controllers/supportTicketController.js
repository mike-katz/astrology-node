const db = require('../db');
require('dotenv').config();
const { uploadImageTos3 } = require('./uploader');

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

        if (!['payment', 'order'].includes(type)) {
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
        if ((type === 'order') && !order_id) {
            return res.status(400).json({
                success: false,
                message: 'Order ID is required for call/chat type tickets'
            });
        }
        let orderDbId = null;
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
            orderDbId = payment?.transaction_id;
        }

        // Verify order belongs to user (if order_id provided)

        if (order_id) {
            const order = await db('orders')
                .where({ id: order_id, user_id: req.userId })
                .whereNull('deleted_at')
                .first();

            if (!order) {
                return res.status(400).json({
                    success: false,
                    message: 'Order not found'
                });
            }
            orderDbId = order.order_id;
        }

        // Create ticket
        const [ticket] = await db('support_tickets').insert({
            user_id: req.userId,
            type,
            issue_type,
            order_id: type == 'order' ? orderDbId : "",
            payment_id: type == 'payment' ? orderDbId : "",
            status: 'open'
        }).returning('*');

        // Create first message in support_tickets_chat
        if (message && ticket?.id) {
            await db('support_tickets_chat').insert({
                support_tickets_id: ticket.id,
                message: message,
                type: 'text',
                user_id: req.userId,
                admin_id: null,
                sender_type: 'user',
                receiver_type: 'admin'
            });
        }

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
            .leftJoin('support_types as s', 's.id', 'st.issue_type')
            .where(filter)
            .select('st.*', 's.name as issue_type')
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
        const { id } = req.query;
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;

        const ticket = await db('support_tickets as st')
            .leftJoin('support_types as s', 's.id', 'st.issue_type')
            .select('st.*', 's.name as issue_type')
            .where({ 'st.id': id, 'st.user_id': req.userId })
            .whereNull('st.deleted_at')
            .first();

        if (!ticket) {
            return res.status(400).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        // Get chat messages with pagination
        const chatMessages = await db('support_tickets_chat as stc')
            .where({ 'stc.support_tickets_id': id })
            .whereNull('stc.deleted_at')
            .select(
                'stc.id',
                'stc.message',
                'stc.type',
                'stc.sender_type',
                'stc.receiver_type',
                'stc.user_id',
                'stc.admin_id',
                'stc.created_at'
            )
            .orderBy('stc.id', 'desc')
            .limit(limit)
            .offset(offset);

        // Get total count of chat messages
        const [{ count }] = await db('support_tickets_chat as stc')
            .where({ 'stc.support_tickets_id': id })
            .whereNull('stc.deleted_at')
            .count('* as count');

        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        return res.status(200).json({
            success: true,
            data: {
                page,
                limit,
                total,
                totalPages,
                results: chatMessages

            },
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
            .where({ status: true })
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

// Reply to support ticket
async function replyTicket(req, res) {
    try {
        const { id, message, type = 'text' } = req.body;
        const { files } = req;

        // Validation
        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Support ticket ID is required'
            });
        }

        // Verify ticket belongs to user
        const ticket = await db('support_tickets')
            .where({ id: id, user_id: req.userId })
            .whereNull('deleted_at')
            .first();

        if (!ticket) {
            return res.status(400).json({
                success: false,
                message: 'Support ticket not found'
            });
        }
        if (ticket.review != null) return res.status(400).json({
            success: false,
            message: 'You already reviewed this ticket.'
        });
        let messageText = message;
        let messageType = type;

        // Handle image upload
        if (type === 'image') {
            if (!files || !Array.isArray(files) || files.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Image file is required for image type'
                });
            }
            const file = files[0];
            const image = await uploadImageTos3('message', file, 'support');
            messageText = image.data.Location;
            messageType = 'image';
        } else if (type === 'text') {
            if (!message || message.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Message is required for text type'
                });
            }
            messageText = message.trim();
        } else {
            return res.status(400).json({
                success: false,
                message: 'Type must be either "text" or "image"'
            });
        }

        // Insert message into support_tickets_chat
        const [chatMessage] = await db('support_tickets_chat').insert({
            support_tickets_id: id,
            message: messageText,
            type: messageType,
            user_id: req.userId,
            admin_id: null,
            sender_type: 'user',
            receiver_type: 'admin'
        }).returning('*');

        await db('support_tickets').where({ id: id, user_id: req.userId }).update({ status: "open" })

        return res.status(200).json({
            success: true,
            data: chatMessage,
            message: 'Reply sent successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function addReview(req, res) {
    try {
        const { ticket_id, review, review_message } = req.body;

        if (!ticket_id) {
            return res.status(400).json({
                success: false,
                message: 'Ticket ID is required.'
            });
        }

        if (!review) {
            return res.status(400).json({
                success: false,
                message: 'Review rating is required.'
            });
        }

        // Validate review rating (assuming 1-5 scale)
        const reviewRating = parseInt(review);
        if (isNaN(reviewRating) || reviewRating < 1 || reviewRating > 5) {
            return res.status(400).json({
                success: false,
                message: 'Review rating must be between 1 and 5.'
            });
        }

        // Verify ticket exists and belongs to this pandit
        const ticket = await db('support_tickets')
            .where({ id: ticket_id, user_id: req.userId })
            .first();

        if (!ticket) {
            return res.status(400).json({
                success: false,
                message: 'Ticket not found or access denied.'
            });
        }

        // Check if review already exists
        const existingReview = await db('support_tickets')
            .where({ id: ticket_id })
            .whereNotNull('review')
            .first();

        if (existingReview && existingReview.review) {
            return res.status(400).json({
                success: false,
                message: 'Review already exists for this ticket.'
            });
        }

        // Update ticket with review
        const [updatedTicket] = await db('support_tickets')
            .where({ id: ticket_id })
            .update({
                review: reviewRating,
                review_message: review_message || null
            })
            .returning('*');

        return res.status(200).json({
            success: true,
            data: { ticket: updatedTicket },
            message: 'Review added successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
}

module.exports = {
    createTicket,
    listTickets,
    getTicketDetail,
    getSupportTypes,
    replyTicket,
    addReview
};
