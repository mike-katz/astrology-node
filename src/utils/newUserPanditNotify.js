const db = require('../db');
const { sendBulkPush } = require('../controllers/reviewController');

const ASTRO_INBOX_MESSAGES = [
    'Namaste! Looking at your kundli, would you like guidance on career or relationships first?',
    'Welcome to AstroGuruji. Shall I check your current dasha and suggest the right remedies?',
    'Hello! I can help with marriage timing, career path, or health concerns — what should we start with?',
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

async function insertAstroInboxMessagesForPandits(userId, pandits) {
    const now = new Date();
    const rows = [];
    for (const pandit of pandits) {
        for (const message of ASTRO_INBOX_MESSAGES) {
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

async function notifyPanditsOnNewUserProfile(userId, userName, languageField) {
    const userLanguages = parseUserLanguages(languageField);
    const pandits = await findRandomAvailablePandits(userLanguages, 5);
    if (!pandits.length) return;

    await notifyNewUserToPandits(pandits, userName);
    // 5 pandits × 3 messages = 15 inbox entries
    await insertAstroInboxMessagesForPandits(userId, pandits);
}

module.exports = {
    parseUserLanguages,
    findRandomAvailablePandits,
    notifyNewUserToPandits,
    insertAstroInboxMessagesForPandits,
    notifyPanditsOnNewUserProfile,
};
