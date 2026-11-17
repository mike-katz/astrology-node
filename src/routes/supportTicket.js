const express = require('express');
const router = express.Router();
const supportTicket = require('../controllers/supportTicketController');
const multer = require('multer');

const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        files: 1,               // max 5 files
        fileSize: 5 * 1024 * 1024 // 5MB per file
    },
    fileFilter: (req, file, cb) => {
        const allowed = (
            file.mimetype.startsWith('image/') ||
            file.mimetype.startsWith('audio/') ||
            file.mimetype.startsWith('video/') ||
            file.mimetype === 'application/pdf'
        );
        if (allowed) {
            cb(null, true);
        } else {
            cb(new Error('Only image, audio, video, and PDF files are allowed'));
        }
    }
});

// Get support types list
router.get('/types', supportTicket.getSupportTypes);

// Create support ticket
router.post('/create', supportTicket.createTicket);

// Reply to support ticket
router.post('/reply', upload.array('file', 1), supportTicket.replyTicket);

// List support tickets
router.get('/list', supportTicket.listTickets);

// Get single ticket details
router.get('/', supportTicket.getTicketDetail);
router.post('/review', supportTicket.addReview);

module.exports = router;
