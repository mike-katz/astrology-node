const db = require('../db');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istParts(date) {
    const shifted = new Date(new Date(date).getTime() + IST_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const day = shifted.getUTCDate();
    const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { year, month, day, ymd, minutes: (shifted.getUTCHours() * 60) + shifted.getUTCMinutes() };
}

function istDayRange(date) {
    const { ymd } = istParts(date);
    return {
        ymd,
        from: new Date(`${ymd}T00:00:00+05:30`),
        to: new Date(`${ymd}T23:59:59.999+05:30`),
    };
}

function istMonthRange(date) {
    const { year, month } = istParts(date);
    const startYmd = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const next = new Date(Date.UTC(year, month + 1, 1));
    const nextYmd = next.toISOString().slice(0, 10);
    return {
        ymd: startYmd,
        from: new Date(`${startYmd}T00:00:00+05:30`),
        to: new Date(new Date(`${nextYmd}T00:00:00+05:30`).getTime() - 1),
    };
}

function clockMinutes(value) {
    const match = String(value || '').match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;
    return (Number(match[1]) * 60) + Number(match[2]);
}

function clockInWindow(at, fromTime, toTime) {
    const start = clockMinutes(fromTime);
    const end = clockMinutes(toTime);
    if (start == null || end == null) return false;
    const { minutes } = istParts(at);
    if (start <= end) return minutes >= start && minutes <= end;
    return minutes >= start || minutes <= end;
}

function applyIstClock(query, column, fromTime, toTime) {
    const start = clockMinutes(fromTime);
    const end = clockMinutes(toTime);
    if (start == null || end == null) return;
    const expr = `(EXTRACT(HOUR FROM ${column} AT TIME ZONE 'Asia/Kolkata')::int * 60 + EXTRACT(MINUTE FROM ${column} AT TIME ZONE 'Asia/Kolkata')::int)`;
    if (start <= end) query.whereRaw(`${expr} BETWEEN ? AND ?`, [start, end]);
    else query.whereRaw(`(${expr} >= ? OR ${expr} <= ?)`, [start, end]);
}

function ruleIncludesPandit(rule, panditId) {
    if (rule.type !== 'customize_order') return true;
    let ids = rule.pandit_ids;
    if (ids == null || ids === '') return true;
    if (typeof ids === 'string') {
        try {
            ids = JSON.parse(ids);
        } catch (_) {
            return true;
        }
    }
    if (!Array.isArray(ids) || !ids.length) return true;
    return ids.map(Number).includes(Number(panditId));
}

function ruleDateMatches(rule, ymd) {
    if (rule.type !== 'customize_order') return true;
    if (!rule.offer_date) return true;
    return String(rule.offer_date).slice(0, 10) === ymd;
}

function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function parseSteps(detail) {
    let value = detail;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch (_) {
            return [];
        }
    }
    return Array.isArray(value?.steps) ? value.steps : [];
}

async function loadRules() {
    return db('pandit_coin_tasks')
        .where({ status: true })
        .whereNull('deleted_at')
        .whereIn('type', ['order', 'customize_order']);
}

async function loadMilestones(taskId) {
    return db('pandit_coin_task_milestones')
        .where({ task_id: taskId })
        .whereNull('deleted_at')
        .orderBy([{ column: 'target', order: 'asc' }, { column: 'id', order: 'asc' }]);
}

async function loadDaySequences(taskId) {
    const has = await db.schema.hasTable('pandit_coin_task_days');
    if (!has) return [];
    return db('pandit_coin_task_days')
        .where({ task_id: taskId })
        .whereNull('deleted_at')
        .orderBy('days', 'asc');
}

async function countCompletedOrders(panditId, from, to, fromTime, toTime) {
    const query = db('orders')
        .where({ pandit_id: panditId, status: 'completed' })
        .whereNull('deleted_at')
        .where('end_time', '>=', from)
        .where('end_time', '<=', to);
    applyIstClock(query, 'end_time', fromTime, toTime);
    const row = await query.count('* as count').first();
    return parseInt(row?.count || 0, 10);
}

async function countQualifyingDays(panditId, month, fromTime, toTime, minimum) {
    const query = db('orders')
        .where({ pandit_id: panditId, status: 'completed' })
        .whereNull('deleted_at')
        .where('end_time', '>=', month.from)
        .where('end_time', '<=', month.to);
    applyIstClock(query, 'end_time', fromTime, toTime);
    const rows = await query.select(db.raw("(end_time AT TIME ZONE 'Asia/Kolkata')::date as day"));
    const counts = new Map();
    for (const row of rows) {
        const key = String(row.day).slice(0, 10);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    let days = 0;
    for (const count of counts.values()) {
        if (count >= minimum) days += 1;
    }
    return days;
}

async function saveTracking(input, attempt = 0) {
    const steps = input.steps || [];
    try {
        await db.transaction(async (trx) => {
            await trx('pandits').where({ id: input.panditId }).forUpdate().first();
            const existing = await trx('pandit_coin_task_progress')
                .where({
                    pandit_id: input.panditId,
                    task_id: input.taskId,
                    period_key: input.periodKey,
                })
                .forUpdate()
                .first();
            const paidByKey = new Map(parseSteps(existing?.detail).map((step) => [String(step.key), !!step.paid]));
            let addCoins = 0;
            let addFreeze = 0;
            const stored = steps.map((step) => {
                const key = String(step.key);
                const paidBefore = paidByKey.get(key) === true;
                const coins = Number(step.coins) || 0;
                const freeze = Number(step.freeze) || 0;
                const pay = !!step.reached && !paidBefore && (coins > 0 || freeze > 0);
                if (pay) {
                    addCoins += coins;
                    addFreeze += freeze;
                }
                return {
                    key,
                    target: Number(step.target) || 0,
                    coins,
                    freeze,
                    reached: !!step.reached,
                    remaining: step.reached ? 0 : round2(Number(step.target) - Number(input.done)),
                    paid: paidBefore || pay,
                };
            });

            if (addCoins > 0) {
                await trx('pandits').where({ id: input.panditId }).update({
                    coin: trx.raw('COALESCE(coin, 0) + ?', [addCoins]),
                });
            }
            if (addFreeze > 0) {
                const streak = await trx('panditcoins').where({ pandit_id: input.panditId }).first();
                if (!streak) {
                    await trx('panditcoins').insert({ pandit_id: input.panditId, freeze: addFreeze });
                } else {
                    await trx('panditcoins').where({ pandit_id: input.panditId }).update({
                        freeze: trx.raw('COALESCE(freeze, 0) + ?', [addFreeze]),
                        updated_at: trx.fn.now(),
                    });
                }
            }

            const open = stored.find((step) => !step.reached);
            const last = stored.length ? stored[stored.length - 1] : null;
            const row = {
                pandit_id: input.panditId,
                task_id: input.taskId,
                period_key: input.periodKey,
                period_type: input.periodType,
                done: round2(input.done),
                unit: input.unit,
                target: open ? open.target : (last ? last.target : null),
                remaining: open ? open.remaining : 0,
                achieved: stored.length > 0 && !open,
                detail: JSON.stringify({ steps: stored }),
                updated_at: new Date(),
            };
            if (existing) {
                await trx('pandit_coin_task_progress').where({ id: existing.id }).update(row);
            } else {
                await trx('pandit_coin_task_progress').insert(row);
            }
        });
    } catch (err) {
        if (err?.code === '23505' && attempt < 1) {
            await saveTracking(input, attempt + 1);
            return;
        }
        console.error('pandit coin tracking save failed', err?.message || err);
    }
}

async function saveDaySequence(rule, panditId, month, qualifyingDays) {
    const sequences = await loadDaySequences(rule.id);
    if (!sequences.length) return;
    await saveTracking({
        panditId,
        taskId: rule.id,
        periodKey: month.ymd,
        periodType: 'month',
        done: qualifyingDays,
        unit: 'days',
        steps: sequences.map((step) => {
            const target = Number(step.days) || 0;
            const reached = qualifyingDays >= target;
            return {
                key: `day:${step.id}`,
                target,
                coins: Number(step.extra_coin) || 0,
                freeze: Number(step.freeze) || 0,
                reached,
                remaining: reached ? 0 : target - qualifyingDays,
            };
        }),
    });
}

/**
 * Order rules only. Live rules are not handled here.
 * Daily milestones and monthly day-sequence progress are stored in pandit_coin_task_progress.
 */
async function awardPanditOrderCoins({ panditId, orderId, completedAt }) {
    const pandit_id = Number(panditId);
    const order_id = Number(orderId);
    if (!pandit_id || !order_id) return;

    const at = completedAt ? new Date(completedAt) : new Date();
    const day = istDayRange(at);
    const month = istMonthRange(at);
    const rules = await loadRules();

    for (const rule of rules) {
        if (!ruleIncludesPandit(rule, pandit_id)) continue;
        if (!ruleDateMatches(rule, day.ymd)) continue;

        const isTime = rule.type === 'customize_order' && String(rule.customize_type || '') === 'time';
        if (isTime) {
            if (!clockInWindow(at, rule.from_time, rule.to_time)) continue;
            const need = Number(rule.order_count) || 0;
            if (!need) continue;
            const count = await countCompletedOrders(pandit_id, day.from, day.to, rule.from_time, rule.to_time);
            const reached = count >= need;
            await saveTracking({
                panditId: pandit_id,
                taskId: rule.id,
                periodKey: day.ymd,
                periodType: 'day',
                done: count,
                unit: 'orders',
                steps: [{
                    key: 'time',
                    target: need,
                    coins: Number(rule.coin) || 0,
                    freeze: 0,
                    reached,
                    remaining: reached ? 0 : need - count,
                }],
            });
            const qualifyingDays = rule.offer_date
                ? (reached ? 1 : 0)
                : await countQualifyingDays(pandit_id, month, rule.from_time, rule.to_time, need);
            await saveDaySequence(rule, pandit_id, month, qualifyingDays);
            continue;
        }

        const count = await countCompletedOrders(pandit_id, day.from, day.to);
        const milestones = await loadMilestones(rule.id);
        await saveTracking({
            panditId: pandit_id,
            taskId: rule.id,
            periodKey: day.ymd,
            periodType: 'day',
            done: count,
            unit: 'orders',
            steps: milestones.map((step) => {
                const target = Number(step.target) || 0;
                const reached = count >= target;
                return {
                    key: String(step.id),
                    target,
                    coins: Number(step.coins) || 0,
                    freeze: 0,
                    reached,
                    remaining: reached ? 0 : target - count,
                };
            }),
        });
        const qualifyingDays = rule.offer_date
            ? (count >= 1 ? 1 : 0)
            : await countQualifyingDays(pandit_id, month, null, null, 1);
        await saveDaySequence(rule, pandit_id, month, qualifyingDays);
    }
}

module.exports = { awardPanditOrderCoins };
