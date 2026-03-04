/**
 * Format a meeting invite message containing the link.
 * @param {string} meetLink - The meeting URL
 * @param {string} [title='Meeting'] - Optional meeting title
 * @returns {string} Formatted message string
 */
function formatMeetingMessage(meetLink, title = 'Meeting') {
  return [
    `*${title} Link Ready*`,
    ``,
    `Join here: ${meetLink}`,
    ``,
    `_Link generated on ${new Date().toUTCString()}_`,
  ].join('\n');
}

/**
 * Format an error message for user-facing responses.
 * @param {string} detail
 * @returns {string}
 */
function formatErrorMessage(detail) {
  return `An error occurred: ${detail}`;
}

module.exports = { formatMeetingMessage, formatErrorMessage };
