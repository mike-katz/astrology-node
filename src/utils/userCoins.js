const db = require('../db');

function getIstDateStr(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(d);
    const map = {};
    parts.forEach((p) => {
        if (p.type !== 'literal') map[p.type] = p.value;
    });
    return `${map.year}-${map.month}-${map.day}`;
}

function formatDateOnly(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    return getIstDateStr(value);
}

function daysBetween(fromStr, toStr) {
    if (!fromStr || !toStr) return null;
    const a = new Date(`${fromStr}T00:00:00+05:30`);
    const b = new Date(`${toStr}T00:00:00+05:30`);
    return Math.round((b - a) / 86400000);
}

function normalizeType(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseJson(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (e) {
        return fallback;
    }
}

function parseActivity(value) {
    const parsed = parseJson(value, []);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function getStreakRewards(settings) {
    const arr = parseJson(settings?.coin_streak_rewards, []);
    if (Array.isArray(arr) && arr.length) {
        return arr.map((item) => ({
            days: Number(item?.days),
            coins: Number(item?.coins || item?.coin || 0),
        })).filter((item) => item.days > 0 && item.coins > 0);
    }
    return [
        { days: 3, coins: 50 },
        { days: 7, coins: 100 },
        { days: 30, coins: 500 },
    ];
}

function taskCoin(task) {
    const n = Number(task?.coin ?? task?.coins ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

async function loadCoinTasks(trx = db) {
    const rows = await trx('astro_coin_task').select('*').orderBy('id', 'asc');
    return rows.filter((row) => {
        if (row.deleted_at) return false;
        if (row.status === false || row.status === 0) return false;
        return true;
    });
}

async function resolveTaskCoin(type) {
    const key = normalizeType(type);
    if (!key) return 0;
    const tasks = await loadCoinTasks();
    const matched = tasks.find((task) => {
        const title = normalizeType(task.title);
        return title === key || title.includes(key) || key.includes(title);
    });
    return taskCoin(matched);
}

async function creditUserCoin(userId, type, coinInput) {
    const activityKey = normalizeType(type);
    if (!activityKey) {
        const err = new Error('Type is required.');
        err.status = 400;
        throw err;
    }

    let reward = Number(coinInput);
    if (!Number.isFinite(reward) || reward <= 0) {
        reward = await resolveTaskCoin(activityKey);
    }
    if (!Number.isFinite(reward) || reward <= 0) {
        const err = new Error('Coin is required.');
        err.status = 400;
        throw err;
    }
    reward = Math.round(reward);

    const today = getIstDateStr();
    return db.transaction(async (trx) => {
        const row = await trx('usercoins').where({ user_id: userId }).forUpdate().first();
        const user = await trx('users').where({ id: userId }).forUpdate().select('id', 'coin').first();
        if (!user) {
            const err = new Error('User not found.');
            err.status = 400;
            throw err;
        }

        let days = Number(row?.days || 0);
        let freeze = Number(row?.freeze || 0);
        let activity = parseActivity(row?.activity);
        const lastDate = formatDateOnly(row?.date);
        const diff = daysBetween(lastDate, today);
        let addStreakBonus = false;

        if (!row || diff == null) {
            days = 1;
            activity = [];
        } else if (diff === 0) {
            if (activity.includes(activityKey)) {
                return {
                    awarded: 0,
                    already: true,
                    type: activityKey,
                    coin: Number(user.coin || 0),
                    days,
                    freeze,
                    activity,
                };
            }
        } else {
            const missed = diff - 1;
            if (missed === 0) {
                days += 1;
                activity = [];
                addStreakBonus = true;
            } else if (freeze >= missed) {
                freeze -= missed;
                days += 1;
                activity = [];
                addStreakBonus = true;
            } else {
                days = 1;
                activity = [];
            }
        }

        activity.push(activityKey);

        const settings = await trx('settings').first();
        const dailyMax = Number(settings?.coin_daily_max || 60);
        const allBonus = Number(settings?.coin_all_activity_bonus || 10);
        const tasks = await loadCoinTasks(trx);
        const uniqueCompletable = [...new Set(tasks.map((item) => normalizeType(item.title)).filter(Boolean))];

        let activityGain = reward;
        if (
            uniqueCompletable.length > 0
            && uniqueCompletable.every((key) => activity.some((done) => done === key || done.includes(key) || key.includes(done)))
            && !activity.includes('all')
        ) {
            activityGain += allBonus;
            activity.push('all');
        }

        const todayActivityTotal = activity
            .filter((key) => key !== 'all')
            .reduce((sum, key) => {
                if (key === activityKey) return sum + reward;
                const matched = tasks.find((item) => {
                    const title = normalizeType(item.title);
                    return title === key || title.includes(key) || key.includes(title);
                });
                return sum + taskCoin(matched);
            }, 0) + (activity.includes('all') ? allBonus : 0);

        if (todayActivityTotal > dailyMax) {
            activityGain = Math.max(activityGain - (todayActivityTotal - dailyMax), 0);
        }

        let streakGain = 0;
        if (addStreakBonus) {
            const streak = getStreakRewards(settings).find((item) => item.days === days);
            if (streak) streakGain = streak.coins;
        }

        const gain = activityGain + streakGain;
        const now = new Date();
        const payload = {
            date: today,
            days,
            freeze,
            activity: JSON.stringify(activity),
            updated_at: now,
        };

        if (!row) {
            await trx('usercoins').insert({
                user_id: userId,
                ...payload,
                created_at: now,
            });
        } else {
            await trx('usercoins').where({ user_id: userId }).update(payload);
        }

        if (gain > 0) {
            await trx('users').where({ id: userId }).increment('coin', gain);
        }

        return {
            awarded: gain,
            already: false,
            type: activityKey,
            coin: Number(user.coin || 0) + gain,
            days,
            freeze,
            activity,
        };
    });
}

module.exports = { creditUserCoin };
