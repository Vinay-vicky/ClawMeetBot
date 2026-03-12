"use strict";
/**
 * RAG (Retrieval-Augmented Generation) service.
 *
 * Embeddings  → HuggingFace Inference API (sentence-transformers/all-MiniLM-L6-v2)
 *               Requires HF_TOKEN env var (free HuggingFace account).
 *               Falls back to keyword/BM25 search when HF_TOKEN is absent.
 *
 * Storage     → knowledge_chunks table in Turso (text + JSON-serialised float vector).
 * AI answers  → routed through existing callAI() (Groq / Kimi / OpenAI / Gemini).
 */

const https   = require("https");
const crypto  = require("crypto");
const logger  = require("../utils/logger");
const { saveChunk, getAllChunks, deleteChunksBySource, getCachedEmbedding, saveCachedEmbedding } = require("./dbService");
const { callAI } = require("./aiSummaryService");

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Split text into overlapping chunks (~500 chars with 50-char overlap).
 * Filters out chunks that are too short to be meaningful.
 */
function splitIntoChunks(text, chunkSize = 500, overlap = 50) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize).trim());
    start += chunkSize - overlap;
    if (start >= text.length) break;
  }
  return chunks.filter((c) => c.length > 30);
}

// ── Embeddings (with cache) ───────────────────────────────────────────────────

/**
 * Generate a 384-dim embedding via HuggingFace Inference API.
 * Results are cached in embedding_cache — identical text is never re-embedded.
 * Returns float[] or null if HF_TOKEN is not set / request fails.
 */
async function embedText(text) {
  const token = process.env.HF_TOKEN;
  if (!token) return null;

  const normalised = text.substring(0, 512);
  const hash = crypto.createHash("sha256").update(normalised).digest("hex").substring(0, 16);

  // Cache hit — skip the API call entirely
  const cached = await getCachedEmbedding(hash).catch(() => null);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* fall through to re-embed */ }
  }

  // Cache miss — call HF API then store result
  const vector = await _fetchEmbedding(normalised, token);
  if (vector) {
    saveCachedEmbedding(hash, JSON.stringify(vector)).catch(() => {});
  }
  return vector;
}

/** Raw HF Inference API call — always use embedText() which handles caching. */
function _fetchEmbedding(text, token) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ inputs: text });
    const options = {
      hostname: "api-inference.huggingface.co",
      path: "/models/sentence-transformers/all-MiniLM-L6-v2",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          // Feature-extraction endpoint returns [[...384 floats...]]
          if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
            resolve(parsed[0]);
          } else {
            if (parsed.error) logger.warn("HF embedding error:", parsed.error);
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", (e) => {
      logger.warn("HF request error:", e.message);
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Keyword fallback scorer ───────────────────────────────────────────────────

function keywordScore(text, queryWords) {
  const lower = text.toLowerCase();
  const hits = queryWords.filter((w) => lower.includes(w)).length;
  return hits / Math.max(queryWords.length, 1);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Index a block of text into the knowledge base.
 * Splits into chunks, generates embeddings (if HF_TOKEN available), stores all.
 *
 * @param {string} text       - Raw content to index
 * @param {string} sourceType - 'meeting_note' | 'transcript' | 'personal_note' | 'team_task' | 'pdf'
 * @param {string} sourceId   - meeting_id, telegram_id, file name, etc.
 * @param {string} sourceName - Human-readable label (meeting subject, file name, etc.)
 * @returns {number} Number of chunks saved
 */
async function indexText(text, sourceType, sourceId, sourceName) {
  if (!text || text.trim().length < 10) return 0;
  const chunks = splitIntoChunks(text);
  let saved = 0;
  for (const chunk of chunks) {
    const embedding = await embedText(chunk);
    await saveChunk(
      sourceType,
      sourceId,
      sourceName,
      chunk,
      embedding ? JSON.stringify(embedding) : null
    );
    saved++;
  }
  logger.info(`RAG: indexed ${saved} chunk(s) [${sourceType}/${sourceName}]`);
  return saved;
}

/**
 * Search knowledge base and return top-N relevant chunks.
 * Uses semantic search when embeddings are available, keyword fallback otherwise.
 *
 * @param {string} query
 * @param {number} limit
 * @returns {Array} Scored chunk rows
 */
async function searchKnowledge(query, limit = 5) {
  const allChunks = await getAllChunks();
  if (allChunks.length === 0) return [];

  const queryEmbedding = await embedText(query);

  let scored;
  if (queryEmbedding) {
    // Semantic cosine similarity
    scored = allChunks.map((chunk) => {
      if (!chunk.embedding) return { ...chunk, score: 0 };
      try {
        const vec = JSON.parse(chunk.embedding);
        return { ...chunk, score: cosine(queryEmbedding, vec) };
      } catch {
        return { ...chunk, score: 0 };
      }
    });
  } else {
    // Keyword BM25 fallback
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    scored = allChunks.map((chunk) => ({
      ...chunk,
      score: keywordScore(chunk.chunk_text, words),
    }));
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter((c) => c.score > 0);
}

/**
 * Answer a natural-language question using RAG + context compression.
 *
 * Flow:
 *   1. Retrieve top-5 relevant chunks (semantic or keyword)
 *   2. Compress / summarise chunks into a tight context (reduces token use)
 *   3. Send compressed context + question to AI
 *
 * @param {string} question
 * @returns {{ answer: string, sources: string[], semantic: boolean }}
 */
async function askKnowledge(question) {
  const chunks = await searchKnowledge(question, 5);

  if (chunks.length === 0) {
    return {
      answer:
        "No relevant information found in the knowledge base yet.\n\n" +
        "Start building it by:\n" +
        "• Saving meeting notes (they\'re auto-indexed)\n" +
        "• Adding personal notes with /note\n" +
        "• Adding team tasks with /teamtask\n" +
        "• Uploading PDFs with /pdf",
      sources: [],
      semantic: false,
    };
  }

  const sources = [...new Set(chunks.map((c) => `${c.source_type}: ${c.source_name}`))];
  const semantic = !!process.env.HF_TOKEN;

  // ── Context compression ────────────────────────────────────────────────────
  // Summarise the retrieved chunks before passing to the final AI call.
  // This removes noise, reduces token count, and improves answer quality.
  const rawContext = chunks
    .map((c, i) => `[${i + 1}] [${c.source_type} — ${c.source_name}]\n${c.chunk_text}`)
    .join("\n\n---\n\n");

  let context = rawContext;
  // Only compress when chunks are large (>1500 chars total)
  if (rawContext.length > 1500) {
    const compressPrompt =
      "You are a context summariser. Given these snippets retrieved for a question, " +
      "produce a concise summary (max 400 words) keeping all facts, names, tasks, " +
      "and dates. Do NOT answer the question — just compress the context.";
    const compressed = await callAI(compressPrompt, `Question: ${question}\n\nSnippets:\n${rawContext}`);
    if (compressed) context = compressed;
  }

  // ── Final answer ───────────────────────────────────────────────────────────
  const systemPrompt =
    "You are a helpful knowledge assistant. Answer questions based ONLY on the provided context. " +
    "Be concise and direct. If the context lacks enough information, say so honestly.";

  const userPrompt = `Context:\n\n${context}\n\n---\n\nQuestion: ${question}`;

  const answer = await callAI(systemPrompt, userPrompt);

  return {
    answer: answer || "Could not generate an answer (AI unavailable).",
    sources,
    semantic,
  };
}

/**
 * Re-index a source (delete old chunks, then index fresh text).
 * Useful when meeting notes are updated.
 */
async function reindexSource(text, sourceType, sourceId, sourceName) {
  await deleteChunksBySource(sourceType, sourceId);
  return indexText(text, sourceType, sourceId, sourceName);
}

module.exports = { indexText, reindexSource, searchKnowledge, askKnowledge, splitIntoChunks };
