"use strict";

const path = require("path");

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.PDF_IMPORT_TIMEOUT_MS || "30000", 10) || 30000;

function toError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function safeUrl(inputUrl) {
  let parsed;
  try {
    parsed = new URL(String(inputUrl || "").trim());
  } catch {
    throw toError("Invalid or unsupported link. Please paste a valid URL.", 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw toError("Only http(s) links are supported.", 400);
  }

  return parsed;
}

function detectSource(inputUrl) {
  const raw = String(inputUrl || "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw.includes("drive.google.com")) return "gdrive";
  if (raw.includes("dropbox.com")) return "dropbox";
  if (raw.endsWith(".pdf") || raw.includes(".pdf?")) return "direct";
  return "unknown";
}

function extractGoogleDriveId(url) {
  const candidates = [
    /\/file\/d\/([^/]+)/i,
    /[?&]id=([^&]+)/i,
    /\/d\/([^/]+)/i,
  ];

  for (const pattern of candidates) {
    const match = String(url || "").match(pattern);
    if (match && match[1]) return match[1];
  }
  return "";
}

function normalizeUrl(inputUrl) {
  const source = detectSource(inputUrl);
  const original = safeUrl(inputUrl);

  if (source === "gdrive") {
    const fileId = extractGoogleDriveId(original.toString());
    if (!fileId) {
      throw toError("Unsupported Google Drive link format. Please use a shareable file link.", 400);
    }
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  }

  if (source === "dropbox") {
    const normalized = new URL(original.toString());
    normalized.searchParams.set("dl", "1");
    return normalized.toString();
  }

  return original.toString();
}

function fileNameFromDisposition(headerValue) {
  const raw = String(headerValue || "");
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const fallbackMatch = raw.match(/filename="?([^";]+)"?/i);
  return fallbackMatch && fallbackMatch[1] ? fallbackMatch[1] : "";
}

function fileNameFromUrl(inputUrl) {
  try {
    const url = new URL(inputUrl);
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    return lastSegment || "document.pdf";
  } catch {
    return "document.pdf";
  }
}

function defaultPdfMagicCheck(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString("utf8") === "%PDF-";
}

async function downloadFileToBuffer(url, options = {}) {
  const maxBytes = Number(options.maxBytes || 0);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "ClawMeetBot/1.0 ImportEngine",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      throw toError("Download timed out. Please try again with a direct PDF link.", 408);
    }
    throw toError("Unable to download the file from that link.", 400);
  }

  clearTimeout(timer);

  if (!response.ok) {
    throw toError(`Could not download that file (HTTP ${response.status}).`, 400);
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(contentLength) && maxBytes > 0 && contentLength > maxBytes) {
    throw toError("File too large for import.", 413);
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    throw toError("Unable to read file stream from the URL.", 400);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (maxBytes > 0 && total > maxBytes) {
      throw toError("File too large for import.", 413);
    }
    chunks.push(chunk);
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType: String(response.headers.get("content-type") || "").toLowerCase(),
    finalUrl: String(response.url || url),
    disposition: String(response.headers.get("content-disposition") || ""),
  };
}

async function importFromUrl(inputUrl, options = {}) {
  const source = detectSource(inputUrl);
  if (source === "unknown") {
    throw toError(
      "Invalid or unsupported link. Supported: direct PDF links, Google Drive, and Dropbox.",
      400,
    );
  }

  const normalizedUrl = normalizeUrl(inputUrl);
  const downloaded = await downloadFileToBuffer(normalizedUrl, {
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
  });

  const rawName = fileNameFromDisposition(downloaded.disposition) || fileNameFromUrl(downloaded.finalUrl || normalizedUrl);
  const fileName =
    typeof options.fileNameSanitizer === "function"
      ? options.fileNameSanitizer(rawName)
      : path.basename(rawName || "document.pdf");

  const isPdfBuffer =
    typeof options.isPdfBuffer === "function"
      ? options.isPdfBuffer(downloaded.buffer)
      : defaultPdfMagicCheck(downloaded.buffer);

  const looksLikePdfByMetadata =
    downloaded.contentType.includes("application/pdf") || /\.pdf$/i.test(String(fileName || ""));

  if (!isPdfBuffer && !looksLikePdfByMetadata) {
    throw toError(
      "Invalid or unsupported link. Supported: direct PDF links, Google Drive, and Dropbox.",
      400,
    );
  }

  return {
    source,
    originalUrl: String(inputUrl || ""),
    normalizedUrl,
    fileName,
    buffer: downloaded.buffer,
    contentType: downloaded.contentType,
  };
}

module.exports = {
  detectSource,
  normalizeUrl,
  importFromUrl,
  downloadFileToBuffer,
};
