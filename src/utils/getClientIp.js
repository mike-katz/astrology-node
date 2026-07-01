function normalizeIp(ip) {
    if (!ip) return '';
    const trimmed = String(ip).trim();
    if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
    return trimmed;
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const ip = forwarded.split(',')[0].trim();
        if (ip) return normalizeIp(ip);
    }

    const realIp = req.headers['x-real-ip'];
    if (realIp) return normalizeIp(realIp);

    return normalizeIp(req.socket?.remoteAddress || req.ip || '');
}

module.exports = { getClientIp, normalizeIp };