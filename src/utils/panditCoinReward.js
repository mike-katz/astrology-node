const db = require('../db');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istParts(date) {
    const shifted = new Date(new Date(date).getTime() + IST_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const day = shifted.getUTCDate();
    const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return {
        year,
        month,
        day,
        ymd,
        minutes: (shifted.getUTCHours() * 60) + shifted.getUTCMinutes(),
    };
}

function istDayRange(date) {
    const { ymd } = istParts(date);
    return {
        ymd,
        from: new Date(`${ymd}T00:00:00+05:30`),
        to: new Date(`${ymd}T23:59:59.999+05:30`),
    };
}

function istWeekRange(date) {
    const { year, month, day } = istParts(date);
    const utc = new Date(Date.UTC(year, month, day));
    const weekday = utc.getUTCDay();
    const back = weekday === 0 ? 6 : weekday - 1;
    utc.setUTCDate(utc.getUTCDate() - back);
    const ymd = utc.toISOString().slice(0, 10);
    const from = new Date(`${ymd}T00:00:00+05:30`);
    const to = new Date(from.getTime() + (7 * 24 * 60 * 60 * 1000) - 1);
    return { ymd, from, to };
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

function rangesOverlap(a0, a1, b0, b1) {
    return a0 < b1 && b0 < a1;
}

function windowRange(ymd, fromTime, toTime) {
    const from = clockMinutes(fromTime);
    const to = clockMinutes(toTime);
    if (from == null || to == null) return null;
    const start = new Date(`${ymd}T${fromTime}:00+05:30`);
    let end = new Date(`${ymd}T${toTime}:00+05:30`);
    if (to <= from) end = new Date(end.getTime() + (24 * 60 * 60 * 1000));
    return [start, end];
}

async function loadRules(types) {
    return db('pandit_coin_tasks')
        .where({ status: true })
        .whereNull('deleted_at')
        .whereIn('type', types);
}

async function loadMilestones(taskId) {
    return db('pandit_coin_task_milestones')
        .where({ task_id: taskId })
        .whereNull('deleted_at')
        .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'target', order: 'asc' }]);
}

async function countCompletedOrders(panditId, from, to) {
    const row = await db('orders')
        .where({ pandit_id: panditId, status: 'completed' })
        .whereNull('deleted_at')
        .where('end_time', '>=', from)
        .where('end_time', '<=', to)
        .count('* as count')
        .first();
    return parseInt(row?.count || 0, 10);
}

async function liveMinutesOnDay(panditId, day) {
    const rows = await db('live_streams')
        .where({ pandit_id: panditId })
        .whereNotNull('ended_at')
        .where('ended_at', '>', day.from)
        .where('created_at', '<', day.to)
        .select('created_at', 'ended_at');
    let ms = 0;
    for (const row of rows) {
        const start = Math.max(new Date(row.created_at).getTime(), day.from.getTime());
        const end = Math.min(new Date(row.ended_at).getTime(), day.to.getTime());
        if (end > start) ms += end - start;
    }
    return ms / 60000;
}

async function grantReward({ panditId, taskId, milestoneId, rewardDate, coins, orderId }) {
    const amount = Number(coins) || 0;
    if (amount <= 0) return;
    try {
        await db.transaction(async (trx) => {
            await trx('pandits').where({ id: panditId }).forUpdate().first();
            const existingQuery = trx('pandit_coin_logs')
                .where({ task_id: taskId, pandit_id: panditId, reward_date: rewardDate });
            if (milestoneId) existingQuery.where({ milestone_id: milestoneId });
            else existingQuery.whereNull('milestone_id');
            const existing = await existingQuery.first();
            if (existing) return;
            await trx('pandit_coin_logs').insert({
                pandit_id: panditId,
                task_id: taskId,
                order_id: orderId || null,
                milestone_id: milestoneId || null,
                reward_date: rewardDate,
                coins: amount,
            });
            await trx('pandits').where({ id: panditId }).update({
                coin: trx.raw('COALESCE(coin, 0) + ?', [amount]),
            });
        });
    } catch (err) {
        if (err?.code === '23505') return;
        throw err;
    }
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

function offerIncludesPandit(rule, panditId) {
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

function isMonthlyOffer(rule) {
    return String(rule.offer_period || '').toLowerCase() === 'monthly';
}

function applyIstClock(query, column, fromTime, toTime) {
    const start = clockMinutes(fromTime);
    const end = clockMinutes(toTime);
    if (start == null || end == null) return;
    const expr = `(EXTRACT(HOUR FROM ${column} AT TIME ZONE 'Asia/Kolkata')::int * 60 + EXTRACT(MINUTE FROM ${column} AT TIME ZONE 'Asia/Kolkata')::int)`;
    if (start <= end) {
        query.whereRaw(`${expr} BETWEEN ? AND ?`, [start, end]);
    } else {
        query.whereRaw(`(${expr} >= ? OR ${expr} <= ?)`, [start, end]);
    }
}

async function countOrderDays(panditId, month, fromTime, toTime) {
    const query = db('orders')
        .where({ pandit_id: panditId, status: 'completed' })
        .whereNull('deleted_at')
        .where('end_time', '>=', month.from)
        .where('end_time', '<=', month.to);
    applyIstClock(query, 'end_time', fromTime, toTime);
    const row = await query
        .select(db.raw("COUNT(DISTINCT (end_time AT TIME ZONE 'Asia/Kolkata')::date) as count"))
        .first();
    return parseInt(row?.count || 0, 10);
}

async function countLiveDays(panditId, month, fromTime, toTime) {
    const rows = await db('live_streams')
        .where({ pandit_id: panditId })
        .whereNotNull('ended_at')
        .where('ended_at', '>', month.from)
        .where('created_at', '<', month.to)
        .select('created_at', 'ended_at');
    const days = new Set();
    const hasClock = clockMinutes(fromTime) != null && clockMinutes(toTime) != null;
    for (const row of rows) {
        const sessionStart = new Date(row.created_at);
        const sessionEnd = new Date(row.ended_at);
        let cursor = new Date(Math.max(sessionStart.getTime(), month.from.getTime()));
        const last = new Date(Math.min(sessionEnd.getTime(), month.to.getTime()));
        let guard = 0;
        while (cursor <= last && guard < 32) {
            const day = istDayRange(cursor);
            const span = hasClock ? windowRange(day.ymd, fromTime, toTime) : [day.from, day.to];
            if (span && rangesOverlap(sessionStart, sessionEnd, span[0], span[1])) days.add(day.ymd);
            cursor = new Date(day.from.getTime() + (24 * 60 * 60 * 1000));
            guard += 1;
        }
    }
    return days.size;
}

async function awardMonthlyOffer(rule, panditId, at, orderId) {
    const month = istMonthRange(at);
    const offerFor = String(rule.offer_for || '').toLowerCase();
    const days = offerFor === 'live'
        ? await countLiveDays(panditId, month, rule.from_time, rule.to_time)
        : await countOrderDays(panditId, month, rule.from_time, rule.to_time);
    const milestones = await loadMilestones(rule.id);
    await saveTaskProgress({
        panditId,
        taskId: rule.id,
        periodKey: month.ymd,
        periodType: 'month',
        done: days,
        unit: 'days',
        steps: buildSteps(milestones, days, 'days'),
    });
    for (const step of milestones) {
        if (days < Number(step.target)) continue;
        await grantReward({
            panditId,
            taskId: rule.id,
            milestoneId: step.id,
            rewardDate: month.ymd,
            coins: step.coins,
            orderId,
        });
    }
    const reached = milestones.some((step) => days >= Number(step.target));
    if (reached) await grantMonthlyFreeze(panditId, rule.id, month.ymd, rule.freeze);
}

async function grantMonthlyFreeze(panditId, taskId, rewardDate, freezeCount) {
    const count = Number(freezeCount) || 0;
    if (count <= 0) return;
    try {
        await db.transaction(async (trx) => {
            await trx('pandits').where({ id: panditId }).forUpdate().first();
            const existing = await trx('pandit_coin_logs')
                .where({ task_id: taskId, pandit_id: panditId, reward_date: rewardDate })
                .whereNull('milestone_id')
                .first();
            if (existing) return;
            await trx('pandit_coin_logs').insert({
                pandit_id: panditId,
                task_id: taskId,
                reward_date: rewardDate,
                coins: 0,
            });
            const streak = await trx('panditcoins').where({ pandit_id: panditId }).first();
            if (!streak) {
                await trx('panditcoins').insert({ pandit_id: panditId, freeze: count });
            } else {
                await trx('panditcoins').where({ pandit_id: panditId }).update({
                    freeze: trx.raw('COALESCE(freeze, 0) + ?', [count]),
                    updated_at: trx.fn.now(),
                });
            }
        });
    } catch (err) {
        if (err?.code === '23505') return;
        throw err;
    }
}

function offerDateMatches(rule, ymd) {
    if (!rule.offer_date) return true;
    return String(rule.offer_date).slice(0, 10) === ymd;
}

function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function buildSteps(milestones, done, unit) {
    return milestones.map((step) => {
        const target = Number(step.target) || 0;
        const reached = Number(done) >= target;
        return {
            milestone_id: step.id || null,
            target,
            coins: Number(step.coins) || 0,
            unit: step.unit || unit || null,
            reached,
            remaining: reached ? 0 : round2(target - Number(done)),
        };
    });
}

function buildLiveSteps(milestones, minutes) {
    return milestones.map((step) => {
        const unit = String(step.unit || 'hours');
        const target = Number(step.target) || 0;
        const current = unit === 'minutes' ? minutes : minutes / 60;
        const reached = current >= target;
        return {
            milestone_id: step.id || null,
            target,
            coins: Number(step.coins) || 0,
            unit,
            reached,
            remaining: reached ? 0 : round2(target - current),
        };
    });
}

function windowSteps(coin, hit, unit) {
    return [{
        milestone_id: null,
        target: 1,
        coins: Number(coin) || 0,
        unit,
        reached: !!hit,
        remaining: hit ? 0 : 1,
    }];
}

async function saveTaskProgress({ panditId, taskId, periodKey, periodType, done, unit, steps }) {
    const list = steps || [];
    const next = list.find((step) => !step.reached);
    const last = list.length ? list[list.length - 1] : null;
    const row = {
        pandit_id: panditId,
        task_id: taskId,
        period_key: periodKey,
        period_type: periodType,
        done: round2(done),
        unit: unit || null,
        target: next ? next.target : (last ? last.target : null),
        remaining: next ? next.remaining : 0,
        achieved: list.length > 0 && !next,
        detail: JSON.stringify({ steps: list }),
        updated_at: new Date(),
    };
    try {
        const existing = await db('pandit_coin_task_progress')
            .where({ pandit_id: row.pandit_id, task_id: row.task_id, period_key: row.period_key })
            .first();
        if (existing) {
            await db('pandit_coin_task_progress').where({ id: existing.id }).update(row);
            return;
        }
        await db('pandit_coin_task_progress').insert(row);
    } catch (err) {
        if (err?.code === '23505') {
            await db('pandit_coin_task_progress')
                .where({ pandit_id: row.pandit_id, task_id: row.task_id, period_key: row.period_key })
                .update(row);
            return;
        }
        console.error('pandit coin progress save failed', err?.message || err);
    }
}

/**
 * Day order milestones, weekly order challenge, and special_offer where offer_for = order.
 * Called after an order is completed. per_order is not awarded.
 * Progress (done and remaining) is stored for each active task.
 */
async function awardPanditOrderCoins({ panditId, orderId, completedAt }) {
    const pandit_id = Number(panditId);
    const order_id = Number(orderId);
    if (!pandit_id || !order_id) return;

    const at = completedAt ? new Date(completedAt) : new Date();
    const day = istDayRange(at);
    const week = istWeekRange(at);
    const rules = await loadRules(['order_day', 'weekly_order', 'special_offer']);

    for (const rule of rules) {
        if (rule.type === 'order_day') {
            const count = await countCompletedOrders(pandit_id, day.from, day.to);
            const milestones = await loadMilestones(rule.id);
            await saveTaskProgress({
                panditId: pandit_id,
                taskId: rule.id,
                periodKey: day.ymd,
                periodType: 'day',
                done: count,
                unit: 'orders',
                steps: buildSteps(milestones, count, 'orders'),
            });
            for (const step of milestones) {
                if (count < Number(step.target)) continue;
                await grantReward({
                    panditId: pandit_id,
                    taskId: rule.id,
                    milestoneId: step.id,
                    rewardDate: day.ymd,
                    coins: step.coins,
                    orderId: order_id,
                });
            }
            continue;
        }

        if (rule.type === 'weekly_order') {
            const need = Number(rule.order_count) || Number(rule.target) || 0;
            const coins = Number(rule.coin) || 0;
            if (!need) continue;
            const count = await countCompletedOrders(pandit_id, week.from, week.to);
            const reached = count >= need;
            await saveTaskProgress({
                panditId: pandit_id,
                taskId: rule.id,
                periodKey: week.ymd,
                periodType: 'week',
                done: count,
                unit: 'orders',
                steps: [{
                    milestone_id: null,
                    target: need,
                    coins,
                    unit: 'orders',
                    reached,
                    remaining: reached ? 0 : need - count,
                }],
            });
            if (!reached || coins <= 0) continue;
            await grantReward({
                panditId: pandit_id,
                taskId: rule.id,
                rewardDate: week.ymd,
                coins,
                orderId: order_id,
            });
            continue;
        }

        if (rule.type === 'special_offer' && String(rule.offer_for || '').toLowerCase() === 'order') {
            if (!offerIncludesPandit(rule, pandit_id)) continue;
            if (isMonthlyOffer(rule)) {
                await awardMonthlyOffer(rule, pandit_id, at, order_id);
                continue;
            }
            if (!offerDateMatches(rule, day.ymd)) continue;
            const hit = clockInWindow(at, rule.from_time, rule.to_time);
            const already = await db('pandit_coin_logs')
                .where({ task_id: rule.id, pandit_id, reward_date: day.ymd })
                .whereNull('milestone_id')
                .first();
            const qualified = !!(hit || already);
            await saveTaskProgress({
                panditId: pandit_id,
                taskId: rule.id,
                periodKey: day.ymd,
                periodType: 'day',
                done: qualified ? 1 : 0,
                unit: 'orders',
                steps: windowSteps(rule.coin, qualified, 'orders'),
            });
            if (!hit) continue;
            await grantReward({
                panditId: pandit_id,
                taskId: rule.id,
                rewardDate: day.ymd,
                coins: rule.coin,
                orderId: order_id,
            });
        }
    }
}

/**
 * Live day milestones and special_offer where offer_for = live.
 * Pass startTime + endTime, or time (minutes) with panditId.
 * A date-like time is only used to test the special_offer clock window.
 */
async function awardPanditLiveCoins({ panditId, startTime, endTime, time }) {
    const pandit_id = Number(panditId);
    if (!pandit_id) return;

    const point = parsePoint(time);
    const end = endTime ? new Date(endTime) : (point || new Date());
    const start = startTime ? new Date(startTime) : null;
    const day = istDayRange(end);
    let minutes = await liveMinutesOnDay(pandit_id, day);

    if (start && !Number.isNaN(start.getTime()) && end > start) {
        const stored = await db('live_streams')
            .where({ pandit_id })
            .whereNotNull('ended_at')
            .where('created_at', '<=', end)
            .where('ended_at', '>=', start)
            .first();
        if (!stored) {
            const clipStart = Math.max(start.getTime(), day.from.getTime());
            const clipEnd = Math.min(end.getTime(), day.to.getTime());
            if (clipEnd > clipStart) minutes += (clipEnd - clipStart) / 60000;
        }
    } else if (!point && time != null && time !== '') {
        const extra = Number(time);
        if (Number.isFinite(extra) && extra > 0) minutes += extra;
    }

    const rules = await loadRules(['live_day', 'special_offer']);
    for (const rule of rules) {
        if (rule.type === 'live_day') {
            const milestones = await loadMilestones(rule.id);
            const steps = buildLiveSteps(milestones, minutes);
            const unit = steps.length && steps.every((step) => step.unit === 'minutes') ? 'minutes' : 'hours';
            await saveTaskProgress({
                panditId: pandit_id,
                taskId: rule.id,
                periodKey: day.ymd,
                periodType: 'day',
                done: unit === 'minutes' ? minutes : minutes / 60,
                unit,
                steps,
            });
            for (const step of milestones) {
                const needMinutes = Number(step.target) * (String(step.unit || 'hours') === 'minutes' ? 1 : 60);
                if (minutes < needMinutes) continue;
                await grantReward({
                    panditId: pandit_id,
                    taskId: rule.id,
                    milestoneId: step.id,
                    rewardDate: day.ymd,
                    coins: step.coins,
                });
            }
            continue;
        }

        if (rule.type !== 'special_offer' || String(rule.offer_for || '').toLowerCase() !== 'live') continue;
        if (!offerIncludesPandit(rule, pandit_id)) continue;
        if (isMonthlyOffer(rule)) {
            await awardMonthlyOffer(rule, pandit_id, end);
            continue;
        }
        if (!offerDateMatches(rule, day.ymd)) continue;
        const hit = await liveHitsWindow({
            panditId: pandit_id,
            day,
            fromTime: rule.from_time,
            toTime: rule.to_time,
            start,
            end: endTime || point ? end : null,
            point,
        });
        const already = await db('pandit_coin_logs')
            .where({ task_id: rule.id, pandit_id, reward_date: day.ymd })
            .whereNull('milestone_id')
            .first();
        const qualified = !!(hit || already);
        await saveTaskProgress({
            panditId: pandit_id,
            taskId: rule.id,
            periodKey: day.ymd,
            periodType: 'day',
            done: qualified ? 1 : 0,
            unit: 'live',
            steps: windowSteps(rule.coin, qualified, 'live'),
        });
        if (!hit) continue;
        await grantReward({
            panditId: pandit_id,
            taskId: rule.id,
            rewardDate: day.ymd,
            coins: rule.coin,
        });
    }
}

function parsePoint(value) {
    if (value == null || value === '' || typeof value === 'number') return null;
    if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

async function liveHitsWindow({ panditId, day, fromTime, toTime, start, end, point }) {
    const window = windowRange(day.ymd, fromTime, toTime);
    if (!window) return false;
    if (point && rangesOverlap(point, new Date(point.getTime() + 1), window[0], window[1])) return true;
    if (start && end && rangesOverlap(start, end, window[0], window[1])) return true;

    const rows = await db('live_streams')
        .where({ pandit_id: panditId })
        .whereNotNull('ended_at')
        .where('ended_at', '>', day.from)
        .where('created_at', '<', day.to)
        .select('created_at', 'ended_at');
    return rows.some((row) => rangesOverlap(
        new Date(row.created_at),
        new Date(row.ended_at),
        window[0],
        window[1],
    ));
}

module.exports = { awardPanditOrderCoins, awardPanditLiveCoins };
