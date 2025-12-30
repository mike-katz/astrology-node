const express = require('express');
const router = express.Router();
const user = require('../controllers/userController');

const multer = require('multer');
const storage = multer.memoryStorage(); // or diskStorage

const upload = multer({
    storage,
    limits: {
        files: 20,              // total files limit
        fileSize: 5 * 1024 * 1024 // 5MB per file
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/jpg',
            'application/pdf'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only images & PDFs allowed'), false);
        }
    }
});

router.get('/', user.getProfile);
router.get('/balance', user.getBalance);
router.post('/update', user.updateProfile);
router.post('/updateToken', user.updateToken);

router.post('/profileUpdate',
    upload.fields([
        { name: 'profile', maxCount: 1 },
    ]),
    user.profileUpdate);

module.exports = router;