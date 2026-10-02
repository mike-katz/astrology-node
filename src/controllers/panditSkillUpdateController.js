const db = require('../db');

const TABLE = 'panditupdaterequests';

function parseJsonField(val) {
    if (val == null || val === '') return null;
    if (typeof val === 'object') return val;
    try {
        return JSON.parse(val);
    } catch {
        return null;
    }
}

function toArray(val) {
    if (val == null || val === '') return [];
    if (Array.isArray(val)) return val.filter((v) => v != null && v !== '').map(String);
    const parsed = parseJsonField(val);
    if (Array.isArray(parsed)) return parsed.filter((v) => v != null && v !== '').map(String);
    if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
}

function hasSubmittedNew(newRaw) {
    const n = parseJsonField(newRaw);
    return !!(n && typeof n === 'object' && !Array.isArray(n) && Object.keys(n).length);
}

function normalizeSkillList(val) {
    return [...new Set(toArray(val).map((v) => String(v).trim()).filter(Boolean))];
}

async function findSkillRequest(token) {
    if (!token || !String(token).trim()) return null;
    return db(TABLE)
        .where({ token: String(token).trim(), type: 'skill' })
        .whereNull('deleted_at')
        .first();
}

function buildSkillPayload(row, pandit) {
    const oldData = parseJsonField(row.old) || {};
    const newData = parseJsonField(row.new) || {};
    const submitted = hasSubmittedNew(row.new);
    const skills = submitted ? newData : oldData;
    return {
        name: pandit?.display_name || pandit?.name || '',
        email: pandit?.email || '',
        submitted,
        status: row.status,
        primary_expertise: toArray(skills.primary_expertise),
        secondary_expertise: toArray(skills.secondary_expertise),
        spell_type: toArray(skills.spell_type),
        spell_type_other: skills.spell_type_other || '',
    };
}

async function getSkillUpdate(req, res) {
    try {
        const token = req.query?.token || req.body?.token;
        if (!token) {
            return res.status(400).json({ success: false, message: 'Missing token.' });
        }

        const row = await findSkillRequest(token);
        if (!row) {
            return res.status(400).json({ success: false, message: 'Invalid or expired link.' });
        }
        if (String(row.status || '').toLowerCase() !== 'pending') {
            return res.status(400).json({ success: false, message: 'This request is already closed.' });
        }

        const pandit = await db('pandits')
            .where({ id: row.pandit_id })
            .whereNull('deleted_at')
            .select('id', 'name', 'display_name', 'email')
            .first();

        return res.status(200).json({
            success: true,
            data: buildSkillPayload(row, pandit),
            message: 'Success',
        });
    } catch (err) {
        console.error('getSkillUpdate:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function submitSkillUpdate(req, res) {
    try {
        const { token, primary_expertise, secondary_expertise, spell_type, spell_type_other } = req.body || {};
        if (!token) {
            return res.status(400).json({ success: false, message: 'Missing token.' });
        }

        const row = await findSkillRequest(token);
        if (!row) {
            return res.status(400).json({ success: false, message: 'Invalid or expired link.' });
        }
        if (String(row.status || '').toLowerCase() !== 'pending') {
            return res.status(400).json({ success: false, message: 'This request is already closed.' });
        }
        if (hasSubmittedNew(row.new)) {
            return res.status(400).json({ success: false, message: 'Skill update already submitted and pending approval.' });
        }

        const primary = normalizeSkillList(primary_expertise);
        const secondary = normalizeSkillList(secondary_expertise);
        if (!primary.length) {
            return res.status(400).json({ success: false, message: 'Please select primary system known.' });
        }
        if (primary.length > 6) {
            return res.status(400).json({ success: false, message: 'You can select maximum 6 primary skills.' });
        }
        if (!secondary.length) {
            return res.status(400).json({ success: false, message: 'Please select consultation categories.' });
        }
        if (secondary.length > 3) {
            return res.status(400).json({ success: false, message: 'You can select maximum 3 consultation categories.' });
        }

        const oldData = parseJsonField(row.old) || {};
        const nextSpellType = spell_type !== undefined
            ? toArray(spell_type)
            : toArray(oldData.spell_type);
        const nextSpellOther = spell_type_other !== undefined
            ? String(spell_type_other || '').trim()
            : (oldData.spell_type_other || '');

        const payload = {
            primary_expertise: primary,
            secondary_expertise: secondary,
            spell_type: nextSpellType,
            spell_type_other: nextSpellOther || null,
            status: 'user submitted',
        };

        await db(TABLE).where({ id: row.id }).update({
            new: JSON.stringify(payload),
            updated_at: new Date(),
        });

        return res.status(200).json({
            success: true,
            data: { submitted: true },
            message: 'Skills submitted successfully. Our team will review after interview.',
        });
    } catch (err) {
        console.error('submitSkillUpdate:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getSkillUpdate, submitSkillUpdate };
