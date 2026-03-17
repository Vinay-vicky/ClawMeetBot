"use strict";
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const {
  getRecentMeetings,
  getPendingTasks,
  getMeetingStats,
  getTaskStats,
  getMeetingAnalytics,
  markTaskDone,
  getAllMembers,
  getTaskEngagementByPerson,
  getUserByLinkToken,
  getPersonalTasks,
  getPersonalNotes,
  getUserByTelegramId,
  updateUserProfileSettings,
  addPersonalTask,
  donePersonalTask,
  deletePersonalTask,
  updatePersonalTask,
  addPersonalNote,
  deletePersonalNote,
  updatePersonalNote,
  savePdfImport,
  getRecentPdfImports,
  getPdfImportById,
} = require("../services/dbService");
const { getScheduledMeetings } = require("../services/calendarService");
const { getTelegramProfilePhotoFileUrl } = require("../services/telegramService");
const {
  isCloudinaryConfigured,
  uploadProfileImageDataUrl,
  deleteImageByPublicId,
} = require("../services/cloudinaryService");
const {
  DASHBOARD_PDF_MAX_BYTES,
  downloadPdfFromUrl,
  ensurePdfFileName,
  formatBytes,
  isProbablyPdf,
  processPdfBuffer,
} = require("../services/pdfIngestionService");
const { cleanup } = require("../services/pdfLLMService");
const logger = require("../utils/logger");

const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const hasSeparateFrontend = Boolean(frontendUrl);
const useSecureCookies = hasSeparateFrontend && /^https:\/\//i.test(frontendUrl);

function authCheck(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return next();
  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const provided = req.query.token || req.headers["x-dashboard-token"] || bearer;
  if (provided === token) return next();
  res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet Dashboard</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#0f1117;color:#e1e4e8;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{text-align:center;padding:40px;background:#161b22;border:1px solid #30363d;border-radius:12px;min-width:300px}h2{color:#58a6ff;margin-bottom:20px;font-size:18px}input{padding:10px 14px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:14px;width:220px;display:block;margin:0 auto 12px}button{padding:10px 24px;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:14px}button:hover{background:#2ea043}</style></head>
<body><div class="box"><h2>&#x1F512; ClawMeet Dashboard</h2><form method="GET"><input name="token" type="password" placeholder="Access token" required><button type="submit">Enter</button></form></div></body></html>`);
}

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.DASHBOARD_TOKEN || "clawmeet-session-2026";
}

function parseCookies(req) {
  const map = {};
  (req.headers.cookie || "").split(";").forEach((part) => {
    const [k, ...vs] = part.trim().split("=");
    if (k) map[k.trim()] = decodeURIComponent(vs.join("="));
  });
  return map;
}

function createSessionCookie(telegramId, name) {
  const payload = Buffer.from(JSON.stringify({ tid: String(telegramId), name: name || "" })).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  const attrs = [
    `cmbt=${payload}.${sig}`,
    "Path=/dashboard",
    "HttpOnly",
    hasSeparateFrontend ? "SameSite=None" : "SameSite=Lax",
    "Max-Age=604800",
  ];
  if (useSecureCookies) attrs.push("Secure");
  return attrs.join("; ");
}

function clearSessionCookie() {
  const attrs = [
    "cmbt=",
    "Path=/dashboard",
    "HttpOnly",
    hasSeparateFrontend ? "SameSite=None" : "SameSite=Lax",
    "Max-Age=0",
  ];
  if (useSecureCookies) attrs.push("Secure");
  return attrs.join("; ");
}

function readSession(req) {
  const val = parseCookies(req).cmbt;
  if (!val) return null;
  const dotIdx = val.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const b64 = val.slice(0, dotIdx);
  const sig = val.slice(dotIdx + 1);
  const expected = crypto.createHmac("sha256", sessionSecret()).update(b64).digest("hex");
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString());
  } catch {
    return null;
  }
}

function buildFrontendUrl(req, pathname, extra = {}) {
  const params = new URLSearchParams();
  if (req.query.token) params.set("token", req.query.token);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      params.set(key, String(value));
    }
  }
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const localPath = hasSeparateFrontend
    ? normalizedPath
    : `/dashboard/ui${normalizedPath === "/" ? "" : normalizedPath}`;
  const query = params.toString();
  const suffix = query ? `${localPath}?${query}` : localPath;
  return hasSeparateFrontend ? `${frontendUrl}${suffix}` : suffix;
}

function wantsJson(req) {
  const accept = req.headers.accept || "";
  const requestedWith = req.headers["x-requested-with"] || "";
  return accept.includes("application/json") || requestedWith === "fetch" || requestedWith === "XMLHttpRequest";
}

function finishMutation(req, res, redirectPath, payload = { ok: true }) {
  if (wantsJson(req)) return res.json(payload);
  return res.redirect(buildFrontendUrl(req, redirectPath));
}

function failMutation(req, res, redirectPath, status, message) {
  if (wantsJson(req)) return res.status(status).json({ error: message });
  return res.redirect(buildFrontendUrl(req, redirectPath, { error: message }));
}

function requireSession(req, res, next) {
  const session = readSession(req);
  if (!session) return res.redirect(buildFrontendUrl(req, "/login", { msg: "Please log in first" }));
  req.session = session;
  next();
}

function requireJsonSession(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  req.session = session;
  next();
}

function safeParseAvatarConfig(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseAvatar(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeHeaderFileName(value) {
  if (Array.isArray(value)) return sanitizeHeaderFileName(value[0]);
  try {
    return ensurePdfFileName(decodeURIComponent(String(value || "document.pdf")));
  } catch {
    return ensurePdfFileName(String(value || "document.pdf"));
  }
}

function buildPdfDownloadName(fileName) {
  const safeFileName = ensurePdfFileName(fileName || "document.pdf");
  const baseName = safeFileName.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "document";
  return `${baseName}-rag-docs.zip`;
}

function pdfImportToResponse(req, row) {
  const zipPath = String(row.zip_path || "");
  const zipAvailable = Boolean(zipPath) && fs.existsSync(path.resolve(zipPath));
  return {
    id: Number(row.id),
    fileName: row.file_name,
    downloadName: row.download_name || buildPdfDownloadName(row.file_name),
    sourceMode: row.source_mode,
    sourceUrl: row.source_url || "",
    pages: Number(row.pages || 0),
    chunks: Number(row.chunks || 0),
    chars: Number(row.chars || 0),
    indexedChunks: Number(row.indexed_chunks || 0),
    createdAt: row.created_at,
    zipAvailable,
    downloadPath: zipAvailable ? `/dashboard/api/me/pdf-imports/${row.id}/download` : "",
    downloadUrl: zipAvailable ? buildFrontendUrl(req, `/api/me/pdf-imports/${row.id}/download`) : "",
  };
}

router.post("/task/:id/done", authCheck, async (req, res) => {
  try {
    await markTaskDone(req.params.id);
    const fallback = buildFrontendUrl(req, "/team");
    const back = wantsJson(req) ? "/team" : (req.headers.referer || fallback);
    if (wantsJson(req)) return res.json({ ok: true });
    return res.redirect(back);
  } catch (err) {
    logger.error("Dashboard mark done error:", err);
    return failMutation(req, res, "/team", 500, "Error marking task done");
  }
});

router.get("/api", authCheck, async (req, res) => {
  try {
    const [meetStats, taskStats, analytics] = await Promise.all([
      getMeetingStats(),
      getTaskStats(),
      getMeetingAnalytics(),
    ]);
    res.json({ meetStats, taskStats, analytics, ts: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/team", authCheck, async (req, res) => {
  try {
    const [meetings, tasks, meetStats, taskStats, analytics] = await Promise.all([
      getRecentMeetings(20),
      getPendingTasks(),
      getMeetingStats(),
      getTaskStats(),
      getMeetingAnalytics(),
    ]);
    let todayMeetings = [];
    try {
      todayMeetings = await getScheduledMeetings(-60, 1440);
    } catch (_) {}
    const summaryCount = meetings.filter((m) => m.summary).length;
    const aiCoverage = meetings.length > 0 ? summaryCount / meetings.length : 0;
    const activityScore = Math.min(1, (meetStats.thisWeek ?? 0) / 5);
    const productivityScore = Math.round(((analytics.completionRate ?? 0) / 100) * 40 + aiCoverage * 30 + activityScore * 30);
    res.json({ meetings, tasks, meetStats, taskStats, analytics, todayMeetings, productivityScore, summaryCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/public", async (req, res) => {
  try {
    const [meetings, meetStats, taskStats, analytics, members, taskEngagement] = await Promise.all([
      getRecentMeetings(10),
      getMeetingStats(),
      getTaskStats(),
      getMeetingAnalytics(),
      getAllMembers(),
      getTaskEngagementByPerson(),
    ]);

    const engagementByName = new Map();
    for (const row of taskEngagement) {
      const key = normalizeName(row.person);
      if (!key) continue;
      engagementByName.set(key, {
        pending: Number(row.pending || 0),
        total: Number(row.total || 0),
        done: Number(row.done || 0),
      });
    }

    const memberDirectory = members.map((m) => {
      const key = normalizeName(m.name);
      const engagement = engagementByName.get(key) || { pending: 0, total: 0, done: 0 };
      return {
        name: m.name,
        email: m.email || "",
        username: "",
        imageUrl: "",
        activeTasks: engagement.pending,
        completedTasks: engagement.done,
        totalTasks: engagement.total,
      };
    });

    memberDirectory.sort((a, b) => {
      if (b.activeTasks !== a.activeTasks) return b.activeTasks - a.activeTasks;
      if (b.totalTasks !== a.totalTasks) return b.totalTasks - a.totalTasks;
      return String(a.name).localeCompare(String(b.name));
    });

    res.json({ meetings, meetStats, taskStats, analytics, members: memberDirectory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/me", requireJsonSession, async (req, res) => {
  const telegramId = req.session.tid;
  try {
    const [user, tasks, notes, imports] = await Promise.all([
      getUserByTelegramId(telegramId),
      getPersonalTasks(telegramId),
      getPersonalNotes(telegramId, 30),
      getRecentPdfImports(telegramId, 8),
    ]);
    res.json({
      user: user || { name: req.session.name, telegram_id: telegramId },
      tasks,
      notes,
      imports: imports.map((row) => pdfImportToResponse(req, row)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/api/me/pdf-upload",
  requireJsonSession,
  express.raw({ type: ["application/pdf", "application/octet-stream"], limit: `${Math.ceil(DASHBOARD_PDF_MAX_BYTES / (1024 * 1024))}mb` }),
  async (req, res) => {
    const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (!fileBuffer.length) return res.status(400).json({ error: "Please choose a PDF file to upload." });
    if (!isProbablyPdf(fileBuffer)) return res.status(400).json({ error: "Only PDF uploads are supported." });

    const originalName = sanitizeHeaderFileName(req.headers["x-file-name"]);

    try {
      const result = await processPdfBuffer(fileBuffer, originalName, {
        sourceType: "pdf_upload",
        sourceName: originalName,
      });

      const importId = await savePdfImport({
        telegramId: req.session.tid,
        fileName: originalName,
        downloadName: buildPdfDownloadName(originalName),
        sourceMode: "upload",
        sourceUrl: "",
        sourceType: "pdf_upload",
        sourceId: result.sourceId,
        pages: result.meta.pages,
        chunks: result.meta.chunks,
        chars: result.meta.chars,
        indexedChunks: result.indexedChunks,
        zipPath: result.zipPath,
      });

      return res.json({
        ok: true,
        importId,
        mode: "upload",
        fileName: originalName,
        pages: result.meta.pages,
        chunks: result.meta.chunks,
        chars: result.meta.chars,
        indexedChunks: result.indexedChunks,
        maxSize: formatBytes(DASHBOARD_PDF_MAX_BYTES),
        downloadPath: `/dashboard/api/me/pdf-imports/${importId}/download`,
      });
    } catch (err) {
      logger.error("Dashboard PDF upload error:", err);
      return res.status(err.status || 500).json({ error: err.message || "Failed to import PDF" });
    }
  },
);

router.post("/api/me/pdf-url", requireJsonSession, express.json({ limit: "256kb" }), async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!url) return res.status(400).json({ error: "Please paste a PDF URL." });

  try {
    const download = await downloadPdfFromUrl(url, { maxBytes: DASHBOARD_PDF_MAX_BYTES });
    const result = await processPdfBuffer(download.buffer, download.fileName, {
      sourceType: "pdf_url",
      sourceName: download.fileName,
    });

    const importId = await savePdfImport({
      telegramId: req.session.tid,
      fileName: download.fileName,
      downloadName: buildPdfDownloadName(download.fileName),
      sourceMode: "url",
      sourceUrl: url,
      sourceType: "pdf_url",
      sourceId: result.sourceId,
      pages: result.meta.pages,
      chunks: result.meta.chunks,
      chars: result.meta.chars,
      indexedChunks: result.indexedChunks,
      zipPath: result.zipPath,
    });

    return res.json({
      ok: true,
      importId,
      mode: "url",
      sourceUrl: url,
      fileName: download.fileName,
      pages: result.meta.pages,
      chunks: result.meta.chunks,
      chars: result.meta.chars,
      indexedChunks: result.indexedChunks,
      maxSize: formatBytes(DASHBOARD_PDF_MAX_BYTES),
      downloadPath: `/dashboard/api/me/pdf-imports/${importId}/download`,
    });
  } catch (err) {
    logger.error("Dashboard PDF URL import error:", err);
    return res.status(err.status || 500).json({ error: err.message || "Failed to import PDF from URL" });
  }
});

router.get("/api/me/pdf-imports/:id/download", requireSession, async (req, res) => {
  try {
    const importRecord = await getPdfImportById(req.params.id, req.session.tid);
    if (!importRecord) return res.status(404).json({ error: "Import not found" });

    const zipPath = path.resolve(String(importRecord.zip_path || ""));
    if (!importRecord.zip_path || !fs.existsSync(zipPath)) {
      return res.status(410).json({ error: "ZIP output is no longer available for this import" });
    }

    return res.download(zipPath, importRecord.download_name || buildPdfDownloadName(importRecord.file_name));
  } catch (err) {
    logger.error("Dashboard PDF ZIP download error:", err);
    return res.status(500).json({ error: "Failed to download ZIP output" });
  }
});

router.post("/api/me/profile", requireJsonSession, express.json({ limit: "1mb" }), async (req, res) => {
  const telegramId = req.session.tid;
  const incomingTheme = String(req.body?.profileTheme || "").toLowerCase();
  const profileTheme = incomingTheme === "light" ? "light" : "dark";

  const incomingAvatar = req.body?.avatarConfig;
  if (!incomingAvatar || typeof incomingAvatar !== "object") {
    return res.status(400).json({ error: "avatarConfig object is required" });
  }

  const shape = ["circle", "rounded", "square"].includes(incomingAvatar.shape)
    ? incomingAvatar.shape
    : "circle";
  const pattern = ["solid", "gradient", "ring"].includes(incomingAvatar.pattern)
    ? incomingAvatar.pattern
    : "gradient";
  const bg = typeof incomingAvatar.bg === "string" ? incomingAvatar.bg.trim().slice(0, 32) : "#f6d37a";
  const accent = typeof incomingAvatar.accent === "string" ? incomingAvatar.accent.trim().slice(0, 32) : "#e6b84e";
  const fg = typeof incomingAvatar.fg === "string" ? incomingAvatar.fg.trim().slice(0, 32) : "#1a1305";
  const symbol = typeof incomingAvatar.symbol === "string" ? incomingAvatar.symbol.trim().slice(0, 2).toUpperCase() : "";
  const source = ["telegram", "upload"].includes(incomingAvatar.source) ? incomingAvatar.source : "custom";
  const imageData = typeof incomingAvatar.imageData === "string"
    ? incomingAvatar.imageData.trim().slice(0, 600000)
    : "";
  const imageUrl = typeof incomingAvatar.imageUrl === "string" ? incomingAvatar.imageUrl.trim().slice(0, 1024) : "";
  const imagePublicId = typeof incomingAvatar.imagePublicId === "string" ? incomingAvatar.imagePublicId.trim().slice(0, 256) : "";
  const isImageDataUrl = /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(imageData);

  let uploadImageUrl = "";
  let uploadPublicId = "";

  try {
    const existingUser = await getUserByTelegramId(telegramId);
    const existingAvatar = safeParseAvatarConfig(existingUser?.avatar_config);
    const existingUploadPublicId =
      existingAvatar?.source === "upload" && typeof existingAvatar.imagePublicId === "string"
        ? existingAvatar.imagePublicId
        : "";

    if (source === "upload") {
      if (isImageDataUrl) {
        if (!isCloudinaryConfigured()) {
          return res.status(503).json({ error: "Image upload service is not configured" });
        }
        const uploaded = await uploadProfileImageDataUrl(imageData, telegramId);
        uploadImageUrl = uploaded.secureUrl;
        uploadPublicId = uploaded.publicId;

        if (existingUploadPublicId && existingUploadPublicId !== uploadPublicId) {
          deleteImageByPublicId(existingUploadPublicId).catch((err) => {
            logger.warn(`Failed to remove previous profile image ${existingUploadPublicId}: ${err.message}`);
          });
        }
      } else if (isHttpUrl(imageUrl)) {
        uploadImageUrl = imageUrl;
        uploadPublicId = imagePublicId;
      } else {
        return res.status(400).json({ error: "Please upload an image before saving" });
      }
    } else if (existingUploadPublicId) {
      deleteImageByPublicId(existingUploadPublicId).catch((err) => {
        logger.warn(`Failed to remove old upload ${existingUploadPublicId}: ${err.message}`);
      });
    }
  } catch (err) {
    logger.error("Profile image processing error:", err);
    return res.status(500).json({ error: "Failed to process profile image" });
  }

  const avatarConfig = {
    shape,
    pattern,
    bg,
    accent,
    fg,
    symbol,
    source,
    imageData: "",
    imageUrl: source === "upload" ? uploadImageUrl : "",
    imagePublicId: source === "upload" ? uploadPublicId : "",
  };

  try {
    await updateUserProfileSettings(telegramId, profileTheme, JSON.stringify(avatarConfig));
    const user = await getUserByTelegramId(telegramId);
    return res.json({ ok: true, user });
  } catch (err) {
    logger.error("Profile update error:", err);
    return res.status(500).json({ error: "Failed to update profile settings" });
  }
});

router.delete("/api/me/upload-photo", requireJsonSession, async (req, res) => {
  const telegramId = req.session.tid;
  try {
    const user = await getUserByTelegramId(telegramId);
    const profileTheme = user?.profile_theme === "light" ? "light" : "dark";
    const existingAvatar = safeParseAvatarConfig(user?.avatar_config) || {};
    const existingUploadPublicId =
      existingAvatar?.source === "upload" && typeof existingAvatar.imagePublicId === "string"
        ? existingAvatar.imagePublicId
        : "";

    if (existingUploadPublicId) {
      await deleteImageByPublicId(existingUploadPublicId);
    }

    const nextAvatar = {
      shape: ["circle", "rounded", "square"].includes(existingAvatar.shape) ? existingAvatar.shape : "circle",
      pattern: ["solid", "gradient", "ring"].includes(existingAvatar.pattern) ? existingAvatar.pattern : "gradient",
      bg: typeof existingAvatar.bg === "string" ? existingAvatar.bg : "#f6d37a",
      accent: typeof existingAvatar.accent === "string" ? existingAvatar.accent : "#e6b84e",
      fg: typeof existingAvatar.fg === "string" ? existingAvatar.fg : "#1a1305",
      symbol: typeof existingAvatar.symbol === "string" ? existingAvatar.symbol.trim().slice(0, 2).toUpperCase() : "",
      source: "custom",
      imageData: "",
      imageUrl: "",
      imagePublicId: "",
    };

    await updateUserProfileSettings(telegramId, profileTheme, JSON.stringify(nextAvatar));
    const refreshedUser = await getUserByTelegramId(telegramId);
    return res.json({ ok: true, user: refreshedUser });
  } catch (err) {
    logger.error("Remove uploaded profile photo error:", err);
    return res.status(500).json({ error: "Failed to remove uploaded photo" });
  }
});

router.get("/api/me/telegram-photo", requireJsonSession, async (req, res) => {
  try {
    let photoUrl = await getTelegramProfilePhotoFileUrl(req.session.tid);

    // Fallback: Telegram public username avatar URL.
    // Useful when bot APIs cannot read profile photos for a given user context.
    if (!photoUrl) {
      const user = await getUserByTelegramId(req.session.tid);
      const username = String(user?.username || "").trim().replace(/^@+/, "");
      if (username) {
        photoUrl = `https://t.me/i/userpic/320/${encodeURIComponent(username)}.jpg`;
      }
    }

    if (!photoUrl) return res.status(204).end();

    const photoRes = await fetch(photoUrl, { cache: "no-store" });
    if (!photoRes.ok) {
      logger.warn(`Telegram photo fetch failed with status ${photoRes.status} for user ${req.session.tid}`);
      return res.status(204).end();
    }

    const contentType = photoRes.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await photoRes.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(buffer);
  } catch (err) {
    logger.error("Telegram profile photo error:", err);
    return res.status(500).json({ error: "Failed to load Telegram profile photo" });
  }
});

router.post("/auth/login", express.urlencoded({ extended: false }), async (req, res) => {
  const linkToken = (req.body.link_token || "").trim();
  if (!linkToken) return res.status(400).json({ error: "Please enter your link token." });
  try {
    const user = await getUserByLinkToken(linkToken);
    if (!user) return res.status(401).json({ error: "Invalid token. Check /myprofile in Telegram." });
    res.setHeader("Set-Cookie", createSessionCookie(user.telegram_id, user.name));
    res.json({ ok: true, name: user.name });
  } catch (err) {
    logger.error("React auth/login error:", err);
    res.status(500).json({ error: "Login failed, please try again." });
  }
});

router.get("/", authCheck, (req, res) => {
  res.redirect(buildFrontendUrl(req, "/team"));
});

router.get("/analytics", authCheck, (req, res) => {
  res.redirect(buildFrontendUrl(req, "/analytics"));
});

router.get("/public", (_req, res) => {
  res.redirect(buildFrontendUrl(_req, "/public"));
});

router.get("/developer", authCheck, (req, res) => {
  res.redirect(buildFrontendUrl(req, "/developer"));
});

router.get("/login", async (req, res) => {
  const session = readSession(req);
  if (session) return res.redirect(buildFrontendUrl(req, "/me"));

  const quickToken = (req.query.token || "").trim();
  if (quickToken) {
    try {
      const user = await getUserByLinkToken(quickToken);
      if (user) {
        res.setHeader("Set-Cookie", createSessionCookie(user.telegram_id, user.name));
        return res.redirect(buildFrontendUrl(req, "/me"));
      }
    } catch (_) {}
    return res.redirect(buildFrontendUrl(req, "/login", {
      error: "Invalid or expired login link. Get a new one via /myprofile in Telegram.",
    }));
  }

  const extra = {};
  if (req.query.error) extra.error = req.query.error;
  if (req.query.msg) extra.msg = req.query.msg;
  res.redirect(buildFrontendUrl(req, "/login", extra));
});

router.post("/login", express.urlencoded({ extended: false }), async (req, res) => {
  const linkToken = (req.body.link_token || "").trim();
  if (!linkToken) return res.redirect(buildFrontendUrl(req, "/login", { error: "Please enter your link token." }));
  try {
    const user = await getUserByLinkToken(linkToken);
    if (!user) return res.redirect(buildFrontendUrl(req, "/login", { error: "Invalid token. Check /myprofile in Telegram." }));
    res.setHeader("Set-Cookie", createSessionCookie(user.telegram_id, user.name));
    res.redirect(buildFrontendUrl(req, "/me"));
  } catch (err) {
    logger.error("Login error:", err);
    res.redirect(buildFrontendUrl(req, "/login", { error: "Login failed, please try again." }));
  }
});

router.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.redirect(buildFrontendUrl(req, "/login", { msg: "You have been logged out" }));
});

router.get("/me", requireSession, (req, res) => {
  res.redirect(buildFrontendUrl(req, "/me"));
});

router.post("/me/task/:id/done", requireSession, async (req, res) => {
  try {
    await donePersonalTask(req.params.id, req.session.tid);
    return finishMutation(req, res, "/me");
  } catch (err) {
    logger.error("Personal task done error:", err);
    return failMutation(req, res, "/me", 500, "Failed to mark personal task done");
  }
});

router.post("/me/task/add", requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { task, deadline } = req.body;
    if (task && task.trim()) {
      await addPersonalTask(req.session.tid, task.trim(), (deadline || "").trim());
    }
    return finishMutation(req, res, "/me");
  } catch (err) {
    logger.error("Personal task add error:", err);
    return failMutation(req, res, "/me", 500, "Failed to add personal task");
  }
});

router.post("/me/task/:id/edit", requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { task, deadline } = req.body;
    if (task && task.trim()) {
      await updatePersonalTask(req.params.id, req.session.tid, task.trim(), (deadline || "").trim());
    }
    return finishMutation(req, res, "/me");
  } catch (err) {
    logger.error("Personal task edit error:", err);
    return failMutation(req, res, "/me", 500, "Failed to update personal task");
  }
});

router.post("/me/task/:id/delete", requireSession, async (req, res) => {
  try {
    await deletePersonalTask(req.params.id, req.session.tid);
    return finishMutation(req, res, "/me");
  } catch (err) {
    logger.error("Personal task delete error:", err);
    return failMutation(req, res, "/me", 500, "Failed to delete personal task");
  }
});

router.post("/me/note/add", requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { note } = req.body;
    if (note && note.trim()) {
      await addPersonalNote(req.session.tid, note.trim());
    }
    return finishMutation(req, res, "/me");
  } catch (err) {
    logger.error("Personal note add error:", err);
    return failMutation(req, res, "/me", 500, "Failed to add personal note");
  }
});

router.post("/me/note/:id/edit", requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { note } = req.body;
    if (note && note.trim()) {
      await updatePersonalNote(req.params.id, req.session.tid, note.trim());
    }
    return finishMutation(req, res, "/me");
  } catch (err) {
    logger.error("Personal note edit error:", err);
    return failMutation(req, res, "/me", 500, "Failed to update personal note");
  }
});

router.post("/me/note/:id/delete", requireSession, async (req, res) => {
  try {
    await deletePersonalNote(req.params.id, req.session.tid);
    return finishMutation(req, res, "/me");
  } catch (err) {
    logger.error("Personal note delete error:", err);
    return failMutation(req, res, "/me", 500, "Failed to delete personal note");
  }
});

if (hasSeparateFrontend) {
  router.get("/ui", (req, res) => {
    res.redirect(buildFrontendUrl(req, "/team"));
  });
  router.get("/ui/*", (req, res) => {
    const subPath = req.path.replace(/^\/ui/, "") || "/";
    res.redirect(buildFrontendUrl(req, subPath === "/" ? "/team" : subPath));
  });
} else {
  const uiDist = path.join(__dirname, "../public/dashboard-ui");
  router.use("/ui", express.static(uiDist));
  router.get("/ui/*", (_req, res) => {
    const idx = path.join(uiDist, "index.html");
    res.sendFile(idx, (err) => {
      if (err) res.status(404).send("React build not found. Run: cd client && npm run build");
    });
  });
}

module.exports = router;
