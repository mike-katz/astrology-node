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
        if (
            file.mimetype.startsWith('image/') ||
            file.mimetype.startsWith('audio/') ||
            file.mimetype === 'application/pdf'
        ) {
            cb(null, true);
        } else {
            cb(new Error('Only images, audio and PDF files are allowed'));
        }
    }
});

// POST /api/auth/login
router.post('/sendMessage', upload.array('message', 5), chat.sendMessage);
router.get('/rooms', chat.getRoom);
router.get('/messages', chat.getMessage);
router.get('/getDetail', chat.getDetail);
router.get('/getOrderDetail', chat.getOrderDetail);
router.post('/endChat', chat.endChat);
router.post('/forceEndChat', chat.forceEndChat);
router.post('/readMessage', chat.readMessage);
router.delete('/delete', chat.deleteChat);
router.post('/upload',
    upload.fields([
        { name: 'file', maxCount: 1 },
    ]),
    chat.uploadImage);
module.exports = router;