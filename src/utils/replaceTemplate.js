/**
 * Replace {key} placeholders in a string with values from data.
 * @param {string} template - e.g. "Call recording with {pandit_name} is ready"
 * @param {Object} data - e.g. { pandit_name: "Pandit Ji" }
 * @returns {string}
 */
function replaceTemplate(template, data) {
    if (template == null || typeof template !== 'string') return '';
    return template.replace(/\{(.*?)\}/g, (_, key) => (data && data[key.trim()]) ?? '');
}

module.exports = { replaceTemplate };
