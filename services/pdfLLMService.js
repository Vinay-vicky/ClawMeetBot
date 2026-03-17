"use strict";
const fs = require("fs");
const path = require("path");
const { PassThrough } = require("stream");
const { PDFParse } = require("pdf-parse");
const archiver = require("archiver");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const { callAI } = require("./aiSummaryService");

// ── Config ─────────────────────────────────────────────────────────────────────
const CHUNK_SIZE = 800;          // characters per RAG chunk
const OVERLAP    = 100;          // character overlap between chunks for context continuity
const MEDIUM_LEN = Number.parseInt(process.env.PDF_LLM_MEDIUM_TARGET_CHARS || "8000", 10);
const SMALL_LEN  = Number.parseInt(process.env.PDF_LLM_SMALL_TARGET_CHARS || "1800", 10);
const SUMMARY_INPUT_MAX = Number.parseInt(process.env.PDF_LLM_SUMMARY_INPUT_MAX_CHARS || "30000", 10);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Clean extracted text: collapse excessive whitespace, normalize line endings */
function cleanText(raw) {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{3,}/g, "  ")   // collapse long horizontal runs
    .replace(/\n{4,}/g, "\n\n\n")  // max 3 blank lines
    .trim();
}

/** Split text into overlapping chunks for better RAG retrieval */
function makeChunks(text, size = CHUNK_SIZE, overlap = OVERLAP) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.substring(i, i + size));
    i += size - overlap;
  }
  return chunks;
}

function hasAnyAiKey() {
  return Boolean(
    process.env.KIMI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GROQ_API_KEY ||
    (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here"),
  );
}

function trimAtSentenceBoundary(text, maxChars) {
  const normalized = cleanText(String(text || ""));
  const target = Number(maxChars || 0);
  if (!target || normalized.length <= target) return normalized;

  const probe = normalized.slice(0, target + 300);
  const boundaryIdx = Math.max(
    probe.lastIndexOf("\n"),
    probe.lastIndexOf(". "),
    probe.lastIndexOf("? "),
    probe.lastIndexOf("! "),
  );

  if (boundaryIdx > Math.floor(target * 0.65)) {
    return probe.slice(0, boundaryIdx + 1).trim();
  }
  return normalized.slice(0, target).trim();
}

function firstSentence(paragraph, maxLen = 220) {
  const normalized = cleanText(String(paragraph || "")).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const match = normalized.match(/.*?[.!?](?:\s|$)/);
  const sentence = match ? match[0].trim() : normalized;
  return sentence.length > maxLen ? `${sentence.slice(0, maxLen - 1).trim()}…` : sentence;
}

function buildStructuredFallbackSummary(text, profile = "medium") {
  const target = profile === "small" ? SMALL_LEN : MEDIUM_LEN;
  const normalized = cleanText(String(text || ""));
  if (!normalized) return "";

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((line) => cleanText(line))
    .filter((line) => line.length > 40);

  if (!paragraphs.length) return trimAtSentenceBoundary(normalized, target);

  const bulletCount = profile === "small" ? 6 : 14;
  const step = Math.max(1, Math.floor(paragraphs.length / bulletCount));
  const selected = [];
  for (let i = 0; i < paragraphs.length && selected.length < bulletCount; i += step) {
    selected.push(paragraphs[i]);
  }

  const lines = [
    profile === "small" ? "# Quick LLM Brief" : "# Structured LLM Summary",
    "",
    "## Overview",
    firstSentence(paragraphs[0], profile === "small" ? 260 : 360),
    "",
    "## Key Points",
    ...selected.map((entry) => `- ${firstSentence(entry, profile === "small" ? 180 : 220)}`),
  ];

  if (profile !== "small" && paragraphs.length > 3) {
    const tail = paragraphs.slice(-2).map((entry) => `- ${firstSentence(entry, 220)}`);
    lines.push("", "## Closing Notes", ...tail);
  }

  return trimAtSentenceBoundary(lines.join("\n"), target);
}

async function buildSemanticSummary(text, profile = "medium") {
  const useAiSummary = String(process.env.PDF_LLM_USE_AI_SUMMARY || "true").toLowerCase() !== "false";
  if (!useAiSummary || !hasAnyAiKey()) return null;

  const target = profile === "small" ? SMALL_LEN : MEDIUM_LEN;
  const boundedInput = trimAtSentenceBoundary(String(text || ""), SUMMARY_INPUT_MAX);
  if (!boundedInput) return null;

  const systemPrompt =
    "You are an expert technical documentation editor. Create clear, structured summaries for LLM context files. " +
    "Use short headings and concise bullet points. Keep factual accuracy high and avoid filler.";

  const userPrompt = profile === "small"
    ? [
      "Create a compact LLM-ready brief from the content below.",
      "Output format:",
      "# Quick LLM Brief",
      "## Core Themes",
      "- bullet points",
      "## Must-Know Facts",
      "- bullet points",
      "Keep it concise and highly informative.",
      "",
      boundedInput,
    ].join("\n")
    : [
      "Create a structured LLM-ready summary from the content below.",
      "Output format:",
      "# Structured LLM Summary",
      "## Overview",
      "(short paragraph)",
      "## Key Concepts",
      "- bullet points",
      "## Important Details",
      "- bullet points",
      "Focus on concepts, definitions, and practical details.",
      "",
      boundedInput,
    ].join("\n");

  const response = await callAI(systemPrompt, userPrompt);
  const cleaned = cleanText(String(response || ""));
  if (!cleaned || cleaned.length < 120) return null;
  return trimAtSentenceBoundary(cleaned, target);
}

async function generateLlmContextVariants(fullText) {
  const normalized = cleanText(String(fullText || ""));
  const full = normalized;
  const llms = full;

  const mediumSemantic = await buildSemanticSummary(full, "medium");
  const medium = mediumSemantic || buildStructuredFallbackSummary(full, "medium");

  // For a stronger small file, summarize the medium output when available.
  const smallSemantic = await buildSemanticSummary(medium || full, "small");
  const small = smallSemantic || buildStructuredFallbackSummary(medium || full, "small");

  return { llms, full, medium, small };
}

async function buildRagZipBuffer(options = {}) {
  const originalName = String(options.originalName || "document.pdf");
  const sourceMode = String(options.sourceMode || "upload");
  const sourceUrl = String(options.sourceUrl || "");
  const pages = Number(options.pages || 0);
  const chars = Number(options.chars || 0);
  const providedChunks = Array.isArray(options.chunks) ? options.chunks : [];
  const chunkTexts = providedChunks
    .map((chunk) => String(chunk || "").trim())
    .filter((chunk) => chunk.length > 0);

  if (!chunkTexts.length) {
    throw new Error("No indexed chunks found for this import");
  }

  const fullText = chunkTexts.join("\n\n");
  const variants = await generateLlmContextVariants(fullText);
  const metadata = {
    source: originalName,
    source_mode: sourceMode,
    source_url: sourceUrl,
    pages,
    chars: chars || fullText.length,
    chunks: chunkTexts.length,
    chunk_size: CHUNK_SIZE,
    overlap: OVERLAP,
    generated_at: new Date().toISOString(),
    generated_from: "knowledge_chunks",
  };

  const readme = [
    `# RAG-Ready Docs — ${originalName}`,
    "",
    `Generated: ${metadata.generated_at}`,
    `Pages: ${metadata.pages}  |  Characters: ${metadata.chars}  |  Chunks: ${metadata.chunks}`,
    "",
    "## Files",
    "| File | Description |",
    "| ---- | ----------- |",
    "| llms.txt | Canonical LLM context file (same as llms-full.txt) |",
    "| llms-full.txt | Reconstructed full text from indexed chunks |",
    "| llms-medium.txt | First ~4 000 characters (section summary) |",
    "| llms-small.txt | First ~1 000 characters (quick context) |",
    "| chunks/chunk_NNNN.txt | Indexed chunks used by RAG retrieval |",
    "| metadata.json | Import and generation metadata |",
  ].join("\n");

  const zipBuffer = await new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = new PassThrough();
    const buffers = [];

    stream.on("data", (chunk) => buffers.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
    archive.on("error", reject);

    archive.pipe(stream);

    archive.append(variants.llms, { name: "llms.txt" });
    archive.append(variants.full, { name: "llms-full.txt" });
    archive.append(variants.medium, { name: "llms-medium.txt" });
    archive.append(variants.small, { name: "llms-small.txt" });
    archive.append(JSON.stringify(metadata, null, 2), { name: "metadata.json" });
    archive.append(readme, { name: "README.md" });

    chunkTexts.forEach((chunk, i) => {
      const header = `[chunk:${i + 1}/${chunkTexts.length}] [source:${originalName}]\n\n`;
      archive.append(`${header}${chunk}`, {
        name: `chunks/chunk_${String(i).padStart(4, "0")}.txt`,
      });
    });

    archive.finalize();
  });

  return { zipBuffer, metadata };
}

/** Write all files for one PDF and return path to the zip */
async function convertPdf(fileBuffer, originalName) {
  const parser = new PDFParse({ data: fileBuffer });
  const parsed = await parser.getText();
  const numpages = (parsed.pages && parsed.pages.length) || 0;
  const text = cleanText(parsed.text);
  const variants = await generateLlmContextVariants(text);

  if (!text || text.length < 10) {
    throw new Error("PDF appears to be empty or image-only (no extractable text).");
  }

  const baseName = (originalName || "document")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .substring(0, 40);

  const folderName = `temp_${baseName}_${uuidv4().split("-")[0]}`;
  const folderPath = path.resolve(folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  // ── 1. Full text ──────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(folderPath, "llms.txt"),        variants.llms, "utf8");
  fs.writeFileSync(path.join(folderPath, "llms-full.txt"),   variants.full, "utf8");

  // ── 2. Medium & small summaries ───────────────────────────────────────────
  fs.writeFileSync(path.join(folderPath, "llms-medium.txt"), variants.medium, "utf8");
  fs.writeFileSync(path.join(folderPath, "llms-small.txt"),  variants.small,  "utf8");

  // ── 3. Metadata ───────────────────────────────────────────────────────────
  const meta = {
    source: originalName || "document.pdf",
    pages: numpages,
    chars: text.length,
    chunks: 0,         // filled below
    chunk_size: CHUNK_SIZE,
    overlap: OVERLAP,
    generated_at: new Date().toISOString(),
  };

  // ── 4. Chunks ─────────────────────────────────────────────────────────────
  const chunks = makeChunks(text);
  meta.chunks = chunks.length;

  const chunksDir = path.join(folderPath, "chunks");
  fs.mkdirSync(chunksDir, { recursive: true });
  chunks.forEach((chunk, i) => {
    const header = `[chunk:${i + 1}/${chunks.length}] [source:${originalName || "document.pdf"}]\n\n`;
    fs.writeFileSync(path.join(chunksDir, `chunk_${String(i).padStart(4, "0")}.txt`), header + chunk, "utf8");
  });

  fs.writeFileSync(path.join(folderPath, "metadata.json"), JSON.stringify(meta, null, 2), "utf8");

  // ── 5. README ─────────────────────────────────────────────────────────────
  const readme = [
    `# RAG-Ready Docs — ${originalName || "document.pdf"}`,
    "",
    `Generated: ${meta.generated_at}`,
    `Pages: ${meta.pages}  |  Characters: ${meta.chars}  |  Chunks: ${meta.chunks}`,
    "",
    "## Files",
    "| File | Description |",
    "| ---- | ----------- |",
    "| llms.txt | Canonical LLM context file (same as llms-full.txt) |",
    "| llms-full.txt | Complete extracted text |",
    "| llms-medium.txt | First ~4 000 characters (section summary) |",
    "| llms-small.txt | First ~1 000 characters (quick context) |",
    "| chunks/chunk_NNNN.txt | 800-char overlapping chunks, ready for vector ingestion |",
    "| metadata.json | Page count, chunk count, generation timestamp |",
    "",
    "## Usage",
    "1. **LLM context window** — paste `llms-medium.txt` directly into a prompt.",
    "2. **RAG pipeline** — embed each `chunks/*.txt` file into a vector DB (Pinecone, Chroma, Supabase, etc.).",
    "3. **Fine-tuning** — use `llms-full.txt` as a training document.",
  ].join("\n");
  fs.writeFileSync(path.join(folderPath, "README.md"), readme, "utf8");

  // ── 6. Zip everything ─────────────────────────────────────────────────────
  const zipPath = `${folderPath}.zip`;
  await new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });

  // Cleanup temp folder
  fs.rmSync(folderPath, { recursive: true, force: true });

  logger.info(`pdfLLMService: created ${zipPath} (${chunks.length} chunks, ${meta.pages} pages)`);
  return { zipPath, meta, text };
}

/** Delete the zip file after it has been sent */
function cleanup(zipPath) {
  try { fs.unlinkSync(zipPath); } catch (_) {}
}

module.exports = { convertPdf, buildRagZipBuffer, generateLlmContextVariants, cleanup };
