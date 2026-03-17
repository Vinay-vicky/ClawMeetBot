"use strict";

const crypto = require("crypto");
const path = require("path");
const logger = require("../utils/logger");
const { convertPdf } = require("./pdfLLMService");
const { reindexSource } = require("./ragService");

const MB = 1024 * 1024;
const DEFAULT_TELEGRAM_PDF_MAX_BYTES = 20 * MB;
const DEFAULT_DASHBOARD_PDF_MAX_BYTES = 50 * MB;

function getByteLimit(envKey, fallback) {
  const value = Number.parseInt(process.env[envKey] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const TELEGRAM_PDF_MAX_BYTES = getByteLimit("TELEGRAM_PDF_MAX_BYTES", DEFAULT_TELEGRAM_PDF_MAX_BYTES);
const DASHBOARD_PDF_MAX_BYTES = getByteLimit("DASHBOARD_PDF_MAX_BYTES", DEFAULT_DASHBOARD_PDF_MAX_BYTES);

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value >= MB) return `${(value / MB).toFixed(value >= 10 * MB ? 0 : 1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function ensurePdfFileName(input) {
  const trimmed = String(input || "document.pdf").trim() || "document.pdf";
  const parsed = path.basename(trimmed).replace(/[\\/:*?"<>|]+/g, "_");
  return /\.pdf$/i.test(parsed) ? parsed : `${parsed}.pdf`;
}

function isProbablyPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString("utf8") === "%PDF-";
}

function makeSourceId(sourceType, sourceName, text) {
  return crypto
    .createHash("sha1")
    .update(`${sourceType}:${sourceName}:${String(text || "").slice(0, 4000)}`)
    .digest("hex")
    .slice(0, 20);
}

function fileNameFromUrl(inputUrl) {
  try {
    const url = new URL(inputUrl);
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    return ensurePdfFileName(lastSegment || "document.pdf");
  } catch {
    return "document.pdf";
  }
}

function fileNameFromDisposition(headerValue) {
  const raw = String(headerValue || "");
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return ensurePdfFileName(decodeURIComponent(utf8Match[1]));
    } catch {
      return ensurePdfFileName(utf8Match[1]);
    }
  }
  const fallbackMatch = raw.match(/filename="?([^";]+)"?/i);
  return fallbackMatch && fallbackMatch[1] ? ensurePdfFileName(fallbackMatch[1]) : null;
}

async function downloadPdfFromUrl(inputUrl, options = {}) {
  const maxBytes = Number(options.maxBytes) || DASHBOARD_PDF_MAX_BYTES;
  let url;
  try {
    url = new URL(String(inputUrl || "").trim());
  } catch {
    const err = new Error("Please enter a valid PDF URL.");
    err.status = 400;
    throw err;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    const err = new Error("Only http(s) PDF URLs are supported.");
    err.status = 400;
    throw err;
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "ClawMeetBot/1.0 PDF Import" },
  });

  if (!response.ok) {
    const err = new Error(`Could not download that PDF (HTTP ${response.status}).`);
    err.status = 400;
    throw err;
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const err = new Error(`That PDF is too large for dashboard import (${formatBytes(contentLength)} > ${formatBytes(maxBytes)}).`);
    err.status = 413;
    throw err;
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const candidateName =
    fileNameFromDisposition(response.headers.get("content-disposition")) ||
    fileNameFromUrl(url.toString());
  const looksLikePdfByMetadata = contentType.includes("application/pdf") || /\.pdf$/i.test(candidateName);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    const err = new Error(`That PDF is too large for dashboard import (${formatBytes(buffer.length)} > ${formatBytes(maxBytes)}).`);
    err.status = 413;
    throw err;
  }

  if (!looksLikePdfByMetadata && !isProbablyPdf(buffer)) {
    const err = new Error("The provided URL does not appear to be a PDF file.");
    err.status = 400;
    throw err;
  }

  return { buffer, fileName: candidateName, contentType };
}

async function processPdfBuffer(fileBuffer, originalName, options = {}) {
  const sourceType = String(options.sourceType || "pdf").trim() || "pdf";
  const safeName = ensurePdfFileName(originalName);
  const { zipPath, meta, text } = await convertPdf(fileBuffer, safeName);
  const sourceName = String(options.sourceName || safeName).trim() || safeName;
  const sourceId = String(options.sourceId || makeSourceId(sourceType, sourceName, text));

  const indexedChunks = await reindexSource(text, sourceType, sourceId, sourceName);

  logger.info(
    `PDF ingested: ${safeName} → ${indexedChunks} indexed chunk(s) [${sourceType}/${sourceId}]`,
  );

  return { zipPath, meta, text, indexedChunks, sourceId, sourceName };
}

module.exports = {
  TELEGRAM_PDF_MAX_BYTES,
  DASHBOARD_PDF_MAX_BYTES,
  downloadPdfFromUrl,
  ensurePdfFileName,
  formatBytes,
  isProbablyPdf,
  processPdfBuffer,
};