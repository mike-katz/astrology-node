const express = require('express');
const router = express.Router();
const chat = require('../controllers/chatController');

const multer = require('multer');
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        files: 5,               // max 5 files
        fileSize: 2 * 1024 * 1024 // (optional) 5MB per file
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/jpg',
            'image/webp',
            'audio/mpeg',   // mp3
            'audio/wav',
            'audio/x-wav',
            'audio/mp4',    // m4a
            'audio/ogg',
            'application/pdf'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only images, audio and PDF files are allowed'), false);
        }
    }
});

// POST /api/auth/login
router.post('/sendMessage', upload.array('message', 5), chat.sendMessage);
router.get('/rooms', chat.getRoom);
router.get('/messages', chat.getMessage);
router.get('/getDetail', chat.getDetail);
router.get('/getOrderDetail', chat.getOrderDetail);
module.exports = router;