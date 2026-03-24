require('dotenv').config();
const logger = require('./utils/logger'); // Pela logger load - folder create + log4js config
const express = require('express');
const app = express();
const auth = require('./middleware/authMiddleware.js');

// Initialize database email queue (Laravel-style)
// Emails are stored in database and processed in background
require('./utils/emailQueue');
require('./workers/emailWorker');

const authRoutes = require('./routes/auth');
const panditRoutes = require('./routes/pandit');
const followRoutes = require('./routes/follow');
const reviewRoutes = require('./routes/review');
const userRoutes = require('./routes/user');
const orderRoutes = require('./routes/order');
const profileRoutes = require('./routes/profile');
const paymentRoutes = require('./routes/payment');
const kundliRoutes = require('./routes/kundli');
const freeKundliRoutes = require('./routes/freekundli');
const supportTicketRoutes = require('./routes/supportTicket');
const faqRoutes = require('./routes/faq');
const blogRoutes = require('./routes/blog');
const bannerRoutes = require('./routes/banners');
const callBackRoutes = require('./routes/callback');
const twilloVoiceRoutes = require('./routes/twilioVoice');
const twilioRoutes = require('./routes/twilio');

// const cors = require('cors');
const multer = require('multer');
const RedisCache = require('./config/redisClient');
const agoraRoutes = require('./routes/agora');
const chatRoutes = require('./routes/chat');
const { decryptRequest } = require('./middleware/decryptRequest.js');
const { encryptResponse } = require('./middleware/encryptResponse.js')

// ✅ ALB health check (NO auth, NO encryption)
app.get("/health", (req, res) => {
    res.status(200).send("user OK");
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use('/callback', callBackRoutes);
app.use('/voice', twilloVoiceRoutes);
app.use('/twilio', twilioRoutes);
app.use('/newKundli', freeKundliRoutes);
app.use(decryptRequest);
app.use(encryptResponse);
RedisCache.initializeRedis();

// app.use(cors());
app.use('/auth', authRoutes);
app.use('/pandit', panditRoutes);
app.use('/upload', panditRoutes);
app.use('/kundli', kundliRoutes);
app.use('/freeKundli', freeKundliRoutes);
app.use('/faq', faqRoutes);
app.use('/blog', blogRoutes);
app.use('/banners', bannerRoutes);
app.use('/call', authRoutes);

// app.use('/agora', agoraRoutes);

app.use(auth)
app.use('/chat', chatRoutes);
app.use('/order', orderRoutes);
app.use('/user', userRoutes);
app.use('/follow', followRoutes);
app.use('/review', reviewRoutes);
app.use('/profile', profileRoutes);
app.use('/payment', paymentRoutes);
app.use('/support-ticket', supportTicketRoutes);
app.use('/agora', agoraRoutes);



app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: err.message });
    }
    if (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next();
});
const port = process.env.PORT || 4000;

app.listen(port, "0.0.0.0", () => logger.log(`Server started on 0.0.0.0:${port}`));