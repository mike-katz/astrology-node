const db = require('../db');
const { sendBulkPush } = require('../controllers/reviewController');

const ASTRO_INBOX_MESSAGES = [
    'Hi! Now that your profile is complete, would you like to explore your career growth or love life?',
    'Welcome to AstroGuruji! I can look at your planetary positions and guide you on the challenges you may be facing.',
    'Hello! Would you like me to check what your kundli indicates about marriage, career, or finances?',
    'Namaste! Your birth details can reveal important patterns — would you like to start with career, marriage, or personal growth?',
    'Hello and welcome! Shall I take a look at your kundli and help you understand your current planetary influences?',
    'Hi! If something has been on your mind lately, tell me about it and I can guide you through what your chart indicates.',
    'Namaste! I would love to help you understand your kundli. What would you like guidance on first — love, career, or money?',
    'Welcome! Your planetary periods can reveal a lot about the phase you are going through. Shall we explore them together?',
    'Hello! Looking for clarity about your future? We can start with marriage, career, finances, or any concern on your mind.',
    'Hi! I have your birth details. Would you like me to check your upcoming opportunities or challenges first?',
    'Namaste! Looking at your kundli, would you like guidance on career or relationships first?',
    'Welcome to AstroGuruji. Shall I check your current dasha and suggest the right remedies?',
    'Hello! I can help with marriage timing, career path, or health concerns — what should we start with?',
    'Namaste! Let us explore what your kundli says about your current life phase. Which area would you like to understand better?',
    'Welcome to AstroGuruji! Whether it is relationships, career, or finances, I can help you find clarity through your kundli.'
];

function parseUserLanguages(languageField) {
    if (!languageField) return [];
    try {
        const parsed = typeof languageField === 'string' ? JSON.parse(languageField) : languageField;
        if (Array.isArray(parsed)) {
            return parsed.map((l) => String(l || '').trim().toLowerCase()).filter(Boolean);
        }
        if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim().toLowerCase()];
    } catch (e) {
        if (typeof languageField === 'string' && languageField.trim()) {
            return [languageField.trim().toLowerCase()];
        }
    }
    return [];
}

async function findRandomAvailablePandits(userLanguages = [], limit = 5) {
    let query = db('pandits')
        .select('id', 'token', 'display_name', 'languages')
        .whereNull('deleted_at')
        .whereNull('waiting_time')
        .where({ status: 'active' })
        .whereNotNull('token')
        .where('token', '!=', '')
        .andWhere(function () {
            this.where('chat', true).orWhere('call', true);
        });

    if (userLanguages.length > 0) {
        const patterns = userLanguages.map((l) => `%${l}%`);
        query = query.andWhereRaw(
            `languages ILIKE ANY (ARRAY[${patterns.map(() => '?').join(',')}])`,
            patterns
        );
    }

    const rows = await query.orderByRaw('RANDOM()').limit(limit);
    return rows.filter((p) => p?.id && p?.token);
}

async function notifyNewUserToPandits(pandits, userName) {
    const tokens = pandits.map((p) => p.token).filter(Boolean);
    if (!tokens.length) return;
    const title = 'New user registered';
    const body = `${userName || 'A new user'} just registered. You can connect now.`;
    await sendBulkPush(tokens, title, body, {
        type: 'new_user_registered',
        user_name: userName || '',
    });
}

async function notifyUserAboutNewAstrologer(userToken, pandit) {
    if (!userToken) return;
    const name = pandit?.display_name || 'An astrologer';
    const title = 'New astrologer available';
    const body = `${name} is available for help. You can connect now.`;
    await sendBulkPush([userToken], title, body, {
        type: 'new_astrologer_available',
        pandit_id: pandit?.id || '',
        pandit_name: name,
    });
}

function pickRandomInboxMessages(countMin = 2, countMax = 3) {
    const pool = [...ASTRO_INBOX_MESSAGES];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const max = Math.min(countMax, pool.length);
    const min = Math.min(countMin, max);
    const count = min + Math.floor(Math.random() * (max - min + 1));
    return pool.slice(0, count);
}

async function insertAstroInboxMessagesForPandits(userId, pandits) {
    const now = new Date();
    const rows = [];
    for (const pandit of pandits) {
        const messages = pickRandomInboxMessages(2, 3);
        for (const message of messages) {
            rows.push({
                user_id: Number(userId),
                pandit_id: Number(pandit.id),
                message,
                is_read: false,
                created_at: now,
                updated_at: now,
            });
        }
    }
    if (!rows.length) return 0;
    await db('inbox_messages').insert(rows);
    return rows.length;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 1 pandit: notify pandit + notify user + random 2–3 inbox msgs, then wait, next...
 * Runs in background so profile API does not hang.
 */
async function processPanditsWithDelay(userId, userName, pandits) {
    const delayMs = 1 * 60 * 1000;
    const user = await db('users').select('token').where({ id: Number(userId) }).first();
    const userToken = user?.token || null;

    for (let i = 0; i < pandits.length; i++) {
        const pandit = pandits[i];
        try {
            await notifyNewUserToPandits([pandit], userName);
            await notifyUserAboutNewAstrologer(userToken, pandit);
            await insertAstroInboxMessagesForPandits(userId, [pandit]);
        } catch (err) {
            console.error(
                `notifyPanditsOnNewUserProfile pandit=${pandit?.id} error:`,
                err?.message || err
            );
        }
        if (i < pandits.length - 1) {
            await wait(delayMs);
        }
    }
}

async function notifyPanditsOnNewUserProfile(userId, userName, languageField) {
    const userLanguages = parseUserLanguages(languageField);
    const pandits = await findRandomAvailablePandits(userLanguages, 5);
    if (!pandits.length) return;

    // fire-and-forget: 1 pandit → 2 min wait → next
    processPanditsWithDelay(userId, userName, pandits).catch((err) => {
        console.error('notifyPanditsOnNewUserProfile delayed error:', err?.message || err);
    });
}

module.exports = {
    parseUserLanguages,
    findRandomAvailablePandits,
    notifyNewUserToPandits,
    notifyUserAboutNewAstrologer,
    insertAstroInboxMessagesForPandits,
    notifyPanditsOnNewUserProfile,
};
