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

function offerDateKey(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(value);
}

function ruleDateMatches(rule, ymd) {
    if (rule.type !== 'customize_order') return true;
    const offerDate = offerDateKey(rule.offer_date);
    if (!offerDate) return true;
    return offerDate === ymd;
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
    if (!steps.length) return;
    try {
        await db.transaction(async (trx) => {
            await trx('pandits').where({ id: input.panditId }).forUpdate().first();
            const legacyRows = await trx('pandit_coin_task_progress')
                .where({
                    pandit_id: input.panditId,
                    task_id: input.taskId,
                    period_key: input.periodKey,
                })
                .whereNull('step_key')
                .forUpdate();
            const paidByKey = new Map();
            for (const row of legacyRows) {
                for (const step of parseSteps(row.detail)) {
                    if (step.paid) paidByKey.set(String(step.key), true);
                }
            }

            let addCoins = 0;
            let addFreeze = 0;
            for (const step of steps) {
                const key = String(step.key);
                const existing = await trx('pandit_coin_task_progress')
                    .where({
                        pandit_id: input.panditId,
                        task_id: input.taskId,
                        period_key: input.periodKey,
                        step_key: key,
                    })
                    .forUpdate()
                    .first();
                const alreadyPaid = paidByKey.get(key) === true || parseSteps(existing?.detail).some((item) => item.paid);
                const coins = Number(step.coins) || 0;
                const freeze = Number(step.freeze) || 0;
                const grantFreeze = step.grantFreeze !== false;
                const reached = !!step.reached;
                const pay = reached && !alreadyPaid && (coins > 0 || (grantFreeze && freeze > 0));
                if (pay) {
                    addCoins += coins;
                    if (grantFreeze) addFreeze += freeze;
                }
                const stored = {
                    key,
                    target: Number(step.target) || 0,
                    coins,
                    freeze,
                    reached,
                    remaining: reached ? 0 : round2(step.remaining != null ? Number(step.remaining) : (Number(step.target) - Number(input.done))),
                    paid: alreadyPaid || pay,
                };
                const row = {
                    pandit_id: input.panditId,
                    task_id: input.taskId,
                    period_key: input.periodKey,
                    period_type: input.periodType,
                    step_key: key,
                    done: round2(input.done),
                    unit: input.unit,
                    target: stored.target,
                    remaining: stored.remaining,
                    achieved: reached,
                    detail: JSON.stringify({ steps: [stored] }),
                    updated_at: new Date(),
                };
                if (existing) {
                    await trx('pandit_coin_task_progress').where({ id: existing.id }).update(row);
                } else {
                    await trx('pandit_coin_task_progress').insert(row);
                }
            }

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

            if (legacyRows.length) {
                await trx('pandit_coin_task_progress').whereIn('id', legacyRows.map((row) => row.id)).del();
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

function ymdList(year, monthIndex, startDay, length) {
    const dim = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const end = Math.min(startDay + length - 1, dim);
    const month = String(monthIndex + 1).padStart(2, '0');
    const dates = [];
    for (let day = startDay; day <= end; day += 1) {
        dates.push(`${year}-${month}-${String(day).padStart(2, '0')}`);
    }
    return dates;
}

function orderSequenceBlocks(at) {
    const { year, month, day } = istParts(at);
    const utc = new Date(Date.UTC(year, month, day));
    const weekday = utc.getUTCDay();
    const back = weekday === 0 ? 6 : weekday - 1;
    utc.setUTCDate(utc.getUTCDate() - back);
    const week = [];
    for (let i = 0; i < 7; i += 1) {
        const date = new Date(utc);
        date.setUTCDate(utc.getUTCDate() + i);
        week.push(date.toISOString().slice(0, 10));
    }
    const firstHalf = ymdList(year, month, 1, 15);
    const fifteen = day > 15 ? ymdList(year, month, 16, 15) : firstHalf;
    const thirty = ymdList(year, month, 1, 30);
    return [
        { days: 7, dates: week, periodKey: `7:${week[0]}` },
        { days: 15, dates: fifteen, periodKey: `15:${fifteen[0]}` },
        { days: 30, dates: thirty, periodKey: `30:${thirty[0]}` },
    ];
}

function blocksCoveredByFreeze(items, allowance) {
    const limit = Math.max(0, Number(allowance) || 0);
    const accepted = new Set();
    const used = new Set();
    const ordered = [...items].sort((a, b) => Number(a.step.days) - Number(b.step.days));
    for (const item of ordered) {
        if (!item.closed) continue;
        const first = item.block.dates[0];
        const last = item.block.dates[item.block.dates.length - 1];
        if (!item.achieved.has(first) || !item.achieved.has(last)) continue;
        if (item.missed.length > limit) continue;
        const next = new Set(used);
        for (const date of item.missed) next.add(date);
        if (next.size > limit) continue;
        for (const date of item.missed) used.add(date);
        accepted.add(item.step.id);
    }
    return accepted;
}

function freezePeriodKey(rule, at) {
    const offer = offerDateKey(rule.offer_date);
    return `freeze:${offer || istMonthRange(at).ymd}`;
}

async function grantCommonFreeze(rule, panditId, at) {
    const count = Number(rule.freeze) || 0;
    if (count <= 0) return;
    if (rule.type !== 'customize_order') return;
    const offer = offerDateKey(rule.offer_date);
    await saveTracking({
        panditId,
        taskId: rule.id,
        periodKey: freezePeriodKey(rule, at),
        periodType: offer ? 'day' : 'month',
        done: 1,
        unit: 'freeze',
        steps: [{
            key: 'freeze',
            target: 1,
            coins: 0,
            freeze: count,
            grantFreeze: true,
            reached: true,
            remaining: 0,
        }],
    });
}

function sqlDayKey(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : String(value || '').slice(0, 10);
}

async function achievedOrderDays(panditId, dates, fromTime, toTime, minimum) {
    const achieved = new Set();
    if (!dates.length || !minimum) return achieved;
    const from = new Date(`${dates[0]}T00:00:00+05:30`);
    const to = new Date(`${dates[dates.length - 1]}T23:59:59.999+05:30`);
    const query = db('orders')
        .where({ pandit_id: panditId, status: 'completed' })
        .whereNull('deleted_at')
        .where('end_time', '>=', from)
        .where('end_time', '<=', to);
    applyIstClock(query, 'end_time', fromTime, toTime);
    const rows = await query.select(db.raw("to_char((end_time AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day"));
    const counts = new Map();
    for (const row of rows) {
        const key = sqlDayKey(row.day);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const ymd of dates) {
        if ((counts.get(ymd) || 0) >= minimum) achieved.add(ymd);
    }
    return achieved;
}

async function awardOrderFreezeSequences(rule, panditId, at) {
    const minimum = Number(rule.order_count) || 0;
    const sequences = (await loadDaySequences(rule.id))
        .filter((step) => [7, 15, 30].includes(Number(step.days)));
    if (!minimum || !sequences.length) return;
    const today = istParts(at).ymd;
    const offer = offerDateKey(rule.offer_date);
    const allowance = Number(rule.freeze) || 0;
    const blocks = new Map(orderSequenceBlocks(at).map((block) => [block.days, block]));
    const prepared = [];
    for (const step of sequences) {
        const block = blocks.get(Number(step.days));
        if (!block) continue;
        let achieved;
        if (offer) {
            achieved = new Set();
            if (block.dates.includes(offer)) {
                const day = istDayRange(new Date(`${offer}T12:00:00+05:30`));
                const count = await countCompletedOrders(panditId, day.from, day.to, rule.from_time, rule.to_time);
                if (count >= minimum) achieved.add(offer);
            }
        } else {
            achieved = await achievedOrderDays(panditId, block.dates, rule.from_time, rule.to_time, minimum);
        }
        const last = block.dates[block.dates.length - 1];
        const closed = today >= last;
        prepared.push({
            step,
            block,
            achieved,
            closed,
            missed: closed ? block.dates.filter((date) => !achieved.has(date)) : [],
            done: block.dates.filter((date) => achieved.has(date)).length,
        });
    }
    const covered = blocksCoveredByFreeze(prepared, allowance);
    for (const item of prepared) {
        const reached = covered.has(item.step.id);
        const uncovered = item.missed.length;
        await saveTracking({
            panditId,
            taskId: rule.id,
            periodKey: item.block.periodKey,
            periodType: 'days',
            done: item.done,
            unit: 'days',
            steps: [{
                key: `day:${item.step.id}`,
                target: Number(item.step.days) || 0,
                coins: Number(item.step.extra_coin) || 0,
                freeze: 0,
                grantFreeze: false,
                reached,
                remaining: reached ? 0 : Math.max(uncovered, 1),
            }],
        });
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
                freeze: 0,
                grantFreeze: false,
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
            if (reached) await grantCommonFreeze(rule, pandit_id, at);
            await awardOrderFreezeSequences(rule, pandit_id, at);
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
        if (rule.type === 'customize_order' && milestones.some((step) => count >= Number(step.target))) {
            await grantCommonFreeze(rule, pandit_id, at);
        }
        await saveDaySequence(rule, pandit_id, month, qualifyingDays);
    }
}

module.exports = { awardPanditOrderCoins };
