"use strict";
/**
 * Simple Telegram message queue.
 * Dispatches one item every 100 ms (≈10/sec; Telegram allows 30/sec for groups).
 * Retries up to 3× after an HTTP 429 "Too Many Requests" response.
 */
const logger = require("./logger");

const queue = [];
let processing = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const { fn, resolve, reject, attempt } = queue.shift();
    try {
      resolve(await fn());
    } catch (err) {
      const retryAfter = err?.response?.body?.parameters?.retry_after;
      const is429 = err?.response?.statusCode === 429 || retryAfter != null;
      if (is429 && attempt < 3) {
        await sleep((retryAfter || 5) * 1000);
        queue.unshift({ fn, resolve, reject, attempt: attempt + 1 });
      } else {
        reject(err);
      }
    }
    if (queue.length > 0) await sleep(100);
  }
  processing = false;
}

/**
 * Enqueue a Telegram API call so the bot never bursts past rate limits.
 * @param {() => Promise<any>} fn  Async function wrapping the API call
 * @returns {Promise<any>}
 */
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject, attempt: 0 });
    processQueue().catch((e) => logger.error("messageQueue fatal:", e));
  });
}

module.exports = { enqueue };
