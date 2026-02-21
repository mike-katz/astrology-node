const db = require('../db');

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomPick = (arr) => arr[randomInt(0, arr.length - 1)];
const randomStr = (len = 8) => Math.random().toString(36).slice(2, 2 + len);

/** GET /test/seed-users?count=5000&batchSize=500 - E j API call ma batch-wise insert. Users table badhi field ma random data. */
const BATCH_SIZE_MAX = 10000;
const LIMIT_PER_REQUEST_MAX = 1000000;

const USER_CITIES = ['Ahmedabad', 'Mumbai', 'Delhi', 'Surat', 'Rajkot', 'Vadodara', 'Pune', 'Chennai', 'Kolkata'];
const USER_LANGUAGES = ['Hindi', 'Gujarati', 'English', 'Marathi'];
const MARITAL_STATUS = ['single', 'married', 'divorced', 'widowed', null];
const OCCUPATIONS = ['Engineer', 'Doctor', 'Teacher', 'Business', 'Student', 'Homemaker', null];
const TOPICS = ['Career', 'Marriage', 'Health', 'Wealth', 'Education', 'Family', null];

function randomUserDate() {
    const y = randomInt(1980, 2000);
    const m = randomInt(1, 12);
    const d = randomInt(1, 28);
    return new Date(y, m - 1, d).toISOString().slice(0, 10);
}

async function seedUsers(req, res) {
    try {
        const countParam = parseInt(req.query.count) || parseInt(req.query.limit) || 10000;
        const limit = Math.min(countParam, LIMIT_PER_REQUEST_MAX);
        const batchSize = Math.min(parseInt(req.query.batchSize) || 500, BATCH_SIZE_MAX);
        const batchSizeFinal = Math.min(batchSize, limit);

        const base = Date.now();
        const batches = [];
        for (let b = 0; b < limit; b += batchSizeFinal) {
            const chunkSize = Math.min(batchSizeFinal, limit - b);
            const rows = [];
            for (let i = 0; i < chunkSize; i++) {
                rows.push({
                    mobile: `9${randomInt(7000000000, 9999999999)}`,
                    country_code: '+91',
                    name: `User_${randomStr(6)}`,
                    email: `test_${base}_${b}_${i}@test.com`,
                    status: 'active',
                    balance: randomInt(0, 5000) / 100,
                    gender: randomPick(['male', 'female', 'other']),
                    birth_time: `${randomInt(1, 12)}:${randomPick(['00', '30'])}`,
                    birth_place: randomPick(USER_CITIES),
                    dob: randomUserDate(),
                    current_address: `${randomInt(1, 999)} ${randomStr(6)} Street`,
                    city_state_country: randomPick(USER_CITIES) + ', India',
                    pincode: String(randomInt(360001, 399999)),
                    profile: `https://test.com/avatar_${randomStr(6)}.jpg`,
                    language: JSON.stringify([randomPick(USER_LANGUAGES), randomPick(USER_LANGUAGES)]),
                    otp: null,
                    online: Math.random() > 0.5,
                    partner_place: Math.random() > 0.6 ? randomPick(USER_CITIES) : null,
                    partner_dot: Math.random() > 0.6 ? `${randomInt(1, 12)}:${randomPick(['00', '30'])}` : null,
                    marital_status: randomPick(MARITAL_STATUS),
                    occupation: randomPick(OCCUPATIONS),
                    topic_of_concern: randomPick(TOPICS),
                    topic_of_concern_other: Math.random() > 0.7 ? randomStr(12) : null,
                    is_enable_partner_detail: Math.random() > 0.5,
                    partner_name: Math.random() > 0.6 ? `Partner_${randomStr(4)}` : null,
                    partner_dob: Math.random() > 0.7 ? randomUserDate() : null,
                    token: null,
                    astromall_chat: Math.random() > 0.6,
                    avatar: `https://test.com/av_${randomStr(6)}.png`,
                    live_event: Math.random() > 0.7,
                    my_interest: JSON.stringify([randomPick(TOPICS), randomPick(TOPICS)]),
                    lat: (randomInt(2000, 3000) / 100).toFixed(4),
                    lng: (randomInt(7200, 7300) / 100).toFixed(4),
                    deleted_at: null,
                    ios_token: null,
                    ad_id: Math.random() > 0.5 ? `ad_${randomStr(6)}` : null,
                    utm_source: Math.random() > 0.5 ? randomPick(['google', 'facebook', 'organic', null]) : null,
                    ad_set_id: Math.random() > 0.6 ? `set_${randomStr(4)}` : null,
                    mode: randomPick(['APP', 'WEB', null]),
                });
            }
            batches.push(rows);
        }

        let totalInserted = 0;
        for (const batch of batches) {
            await db('users').insert(batch);
            totalInserted += batch.length;
        }

        return res.status(200).json({
            success: true,
            inserted: totalInserted,
            batches: batches.length,
            message: `Inserted ${totalInserted} users in ${batches.length} batch(es) (batchSize ${batchSizeFinal}). Same API call ma j batch-wise insert thayu.`,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/** GET /test/seed-orders?count=5000&batchSize=500 - E j API call ma batch-wise insert (same as seed-users). */
async function seedOrders(req, res) {
    try {
        const countParam = parseInt(req.query.count) || parseInt(req.query.limit) || 100;
        const limit = Math.min(countParam, LIMIT_PER_REQUEST_MAX);
        const batchSize = Math.min(parseInt(req.query.batchSize) || 500, BATCH_SIZE_MAX);
        const batchSizeFinal = Math.min(batchSize, limit);

        const userIds = await db('users').select('id').limit(500).then(rows => rows.map(r => r.id));
        const panditIds = await db('pandits').select('id').whereNull('deleted_at').limit(500).then(rows => rows.map(r => r.id));
        if (!userIds.length || !panditIds.length) {
            return res.status(400).json({ success: false, message: 'Need at least one user and one pandit in DB.' });
        }
        const statuses = ['pending', 'continue', 'complete', 'cancel'];
        const types = ['chat', 'call'];

        const base = Date.now();
        const batches = [];
        for (let b = 0; b < limit; b += batchSizeFinal) {
            const chunkSize = Math.min(batchSizeFinal, limit - b);
            const rows = [];
            for (let i = 0; i < chunkSize; i++) {
                rows.push({
                    user_id: randomPick(userIds),
                    pandit_id: randomPick(panditIds),
                    order_id: `${base}${randomInt(100000, 999999)}_${b}_${i}`,
                    status: randomPick(statuses),
                    type: randomPick(types),
                    rate: randomInt(1, 50),
                    duration: randomInt(1, 60),
                    deduction: 0,
                    is_accept: Math.random() > 0.5,
                    is_free: Math.random() > 0.7,
                });
            }
            batches.push(rows);
        }

        let totalInserted = 0;
        for (const batch of batches) {
            await db('orders').insert(batch);
            totalInserted += batch.length;
        }
        return res.status(200).json({
            success: true,
            inserted: totalInserted,
            batches: batches.length,
            message: `Inserted ${totalInserted} orders in ${batches.length} batch(es) (batchSize ${batchSizeFinal}). Same API call ma j batch-wise insert thayu.`,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/** GET /test/seed-chats?count=5000&batchSize=500 - E j API call ma batch-wise insert (same as seed-users). */
async function seedChats(req, res) {
    try {
        const countParam = parseInt(req.query.count) || parseInt(req.query.limit) || 100;
        const limit = Math.min(countParam, LIMIT_PER_REQUEST_MAX);
        const batchSize = Math.min(parseInt(req.query.batchSize) || 500, BATCH_SIZE_MAX);
        const batchSizeFinal = Math.min(batchSize, limit);

        const orders = await db('orders').select('id', 'order_id', 'user_id', 'pandit_id').limit(1000);
        if (!orders.length) {
            return res.status(400).json({ success: false, message: 'Need at least one order in DB.' });
        }
        const messages = ['Hello', 'Namaste', 'Need guidance', 'Thanks', 'Okay', 'Yes', 'No', 'Please tell more', 'When?', 'Got it'];

        const batches = [];
        for (let b = 0; b < limit; b += batchSizeFinal) {
            const chunkSize = Math.min(batchSizeFinal, limit - b);
            const rows = [];
            for (let i = 0; i < chunkSize; i++) {
                const order = randomPick(orders);
                const isUserSender = Math.random() > 0.5;
                rows.push({
                    sender_id: isUserSender ? order.user_id : order.pandit_id,
                    receiver_id: isUserSender ? order.pandit_id : order.user_id,
                    sender_type: isUserSender ? 'user' : 'pandit',
                    receiver_type: isUserSender ? 'pandit' : 'user',
                    order_id: order.order_id,
                    message: randomPick(messages) + ' ' + randomStr(4),
                    status: 'send',
                    type: 'text',
                    is_system_generate: false,
                });
            }
            batches.push(rows);
        }

        let totalInserted = 0;
        for (const batch of batches) {
            await db('chats').insert(batch);
            totalInserted += batch.length;
        }
        return res.status(200).json({
            success: true,
            inserted: totalInserted,
            batches: batches.length,
            message: `Inserted ${totalInserted} chats in ${batches.length} batch(es) (batchSize ${batchSizeFinal}). Same API call ma j batch-wise insert thayu.`,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/** GET /test/seed-pandits?count=5000&batchSize=200 - Pandits table ma batch-wise random data insert (badhi field ma data). */
const PANDIT_CITIES = ['Ahmedabad', 'Mumbai', 'Delhi', 'Surat', 'Rajkot', 'Vadodara', 'Pune', 'Chennai', 'Kolkata', 'Bangalore'];
const PANDIT_EXPERTISE = ['Vedic Astrology', 'Kundli', 'Numerology', 'Palmistry', 'Vastu', 'Tarot', 'Gemstone', 'Remedies', 'Muhurat', 'Marriage'];
const PANDIT_LANGUAGES = ['Hindi', 'Gujarati', 'English', 'Marathi', 'Tamil', 'Telugu', 'Bengali'];
const PANDIT_TAGS = ['Top', 'Featured', 'New', 'Senior', 'Expert', null];
const BANK_NAMES = ['SBI', 'HDFC', 'ICICI', 'Axis', 'Kotak', 'PNB', null];

function randomDate(startYear = 1970, endYear = 1995) {
    const y = randomInt(startYear, endYear);
    const m = randomInt(1, 12);
    const d = randomInt(1, 28);
    return new Date(y, m - 1, d).toISOString().slice(0, 10);
}

function randomTime() {
    return `${String(randomInt(8, 20)).padStart(2, '0')}:${randomPick(['00', '30'])}`;
}

async function seedPandits(req, res) {
    try {
        const countParam = parseInt(req.query.count) || parseInt(req.query.limit) || 100;
        const limit = Math.min(countParam, LIMIT_PER_REQUEST_MAX);
        const batchSize = Math.min(parseInt(req.query.batchSize) || 200, BATCH_SIZE_MAX);
        const batchSizeFinal = Math.min(batchSize, limit);

        const base = Date.now();
        const batches = [];
        for (let b = 0; b < limit; b += batchSizeFinal) {
            const chunkSize = Math.min(batchSizeFinal, limit - b);
            const rows = [];
            for (let i = 0; i < chunkSize; i++) {
                const chatRate = randomInt(5, 100);
                const discount = randomInt(0, 30);
                const bank = randomPick(BANK_NAMES);
                rows.push({
                    mobile: `9${randomInt(7000000000, 9999999999)}`,
                    country_code: '+91',
                    name: `Pandit_${randomStr(6)}`,
                    display_name: `Pandit ${randomStr(5)}`,
                    dob: randomDate(),
                    city: randomPick(PANDIT_CITIES),
                    email: `pandit_${base}_${b}_${i}@test.com`,
                    balance: randomInt(0, 5000) / 100,
                    status: 'active',
                    is_streaming: Math.random() > 0.8,
                    chat: Math.random() > 0.2,
                    call: Math.random() > 0.2,
                    unlimited_free_calls_chats: Math.random() > 0.7,
                    boost_my_profile: Math.random() > 0.8,
                    available_for: JSON.stringify([randomPick(['chat', 'call'])]),
                    chat_call_rate: chatRate,
                    experience: randomInt(1, 30) + Math.random(),
                    discounted_chat_call_rate: chatRate * (1 - discount / 100),
                    final_chat_call_rate: chatRate * (1 - discount / 100),
                    total_chat_minutes: randomInt(0, 5000),
                    total_call_minutes: randomInt(0, 2000),
                    about: `Test pandit ${randomStr(20)} - astrology expert.`,
                    profile: `https://test.com/profile_${randomStr(6)}.jpg`,
                    token: null,
                    whats_app_status: Math.random() > 0.5 ? `Status ${randomStr(8)}` : null,
                    whats_app_expire: Math.random() > 0.6 ? new Date(Date.now() + 86400000 * randomInt(1, 30)).toISOString() : null,
                    online: Math.random() > 0.5,
                    gender: randomPick(['male', 'female']),
                    total_orders: randomInt(0, 500),
                    tag: randomPick(PANDIT_TAGS),
                    consent_profile: true,
                    primary_expertise: JSON.stringify([randomPick(PANDIT_EXPERTISE), randomPick(PANDIT_EXPERTISE)]),
                    secondary_expertise: JSON.stringify([randomPick(PANDIT_EXPERTISE)]),
                    languages: JSON.stringify([randomPick(PANDIT_LANGUAGES), randomPick(PANDIT_LANGUAGES)]),
                    offer_live_session: randomPick(['yes', 'no', null]),
                    live_start_time: randomTime(),
                    live_end_time: randomTime(),
                    training_type: randomPick(['Traditional', 'Self', 'Guru', 'Institute']),
                    guru_name: Math.random() > 0.5 ? `Guru ${randomStr(4)}` : null,
                    certificate: JSON.stringify([`https://test.com/cert_${randomStr(4)}.pdf`]),
                    govt_id: JSON.stringify([`ID_${randomStr(8)}`]),
                    achievement_url: `https://test.com/ach_${randomStr(6)}.jpg`,
                    selfie: `https://test.com/selfie_${randomStr(6)}.jpg`,
                    achievement_file: Math.random() > 0.7 ? `https://test.com/ach_${randomStr(4)}.pdf` : null,
                    terms: true,
                    no_false: true,
                    country: randomPick(['India', 'USA', 'UK', 'UAE', 'India']),
                    rating_1: randomInt(0, 20),
                    rating_2: randomInt(0, 30),
                    rating_3: randomInt(0, 50),
                    rating_4: randomInt(10, 100),
                    rating_5: randomInt(50, 200),
                    deleted_at: null,
                    waiting_time: Math.random() > 0.7 ? new Date(Date.now() - 3600000 * randomInt(1, 24)).toISOString() : null,
                    chat_call_share: randomInt(60, 80) + Math.random(),
                    gift_share: randomInt(40, 60) + Math.random(),
                    total_follows: randomInt(0, 500),
                    chat_online_time: randomInt(0, 500) + Math.random(),
                    call_online_time: randomInt(0, 300) + Math.random(),
                    base_rate: chatRate + Math.random(),
                    audio_intro: Math.random() > 0.6 ? `https://test.com/audio_${randomStr(4)}.mp3` : null,
                    video_intro: Math.random() > 0.7 ? `https://test.com/video_${randomStr(4)}.mp4` : null,
                    interviewer_name: Math.random() > 0.5 ? `Interviewer ${randomStr(4)}` : null,
                    interviewer_remark: Math.random() > 0.6 ? `Remark ${randomStr(12)}` : null,
                    bank_name: bank,
                    ac_no: bank ? `${randomInt(1000000000, 9999999999)}` : null,
                    ifsc: bank ? `SBIN${randomStr(7)}` : null,
                    holder_name: bank ? `Pandit ${randomStr(5)}` : null,
                    auto_offline: randomInt(5, 60),
                    cancel_cheque: Math.random() > 0.6 ? `https://test.com/cheque_${randomStr(4)}.jpg` : null,
                    accept_performance: randomInt(50, 100) + Math.random(),
                    share: randomInt(60, 80),
                    response_time_performance: randomInt(40, 100),
                });
            }
            batches.push(rows);
        }

        let totalInserted = 0;
        for (const batch of batches) {
            await db('pandits').insert(batch);
            totalInserted += batch.length;
        }
        return res.status(200).json({
            success: true,
            inserted: totalInserted,
            batches: batches.length,
            message: `Inserted ${totalInserted} pandits in ${batches.length} batch(es) (batchSize ${batchSizeFinal}). Same API call ma j batch-wise insert thayu.`,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = { seedUsers, seedOrders, seedChats, seedPandits };
