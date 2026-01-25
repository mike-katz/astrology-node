const express = require('express');
const router = express.Router();
const supportTicket = require('../controllers/supportTicketController');

// Get support types list
router.get('/types', supportTicket.getSupportTypes);

// Get payments list for support ticket (when type is payment)
router.get('/payments', supportTicket.getPaymentsForTicket);

// Get orders for a specific payment
router.get('/orders-for-payment', supportTicket.getOrdersForPayment);

// Create support ticket
router.post('/create', supportTicket.createTicket);

// List support tickets
router.get('/list', supportTicket.listTickets);

// Get single ticket details
router.get('/:id', supportTicket.getTicketDetail);

module.exports = router;
