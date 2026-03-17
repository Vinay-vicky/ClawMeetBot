"use strict";
const fs = require("fs");
const path = require("path");
const { PassThrough } = require("stream");
const { PDFParse } = require("pdf-parse");
const archiver = require("archiver");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");

// ── Config ─────────────────────────────────────────────────────────────────────
const CHUNK_SIZE = 800;          // characters per RAG chunk
const OVERLAP    = 100;          // character overlap between chunks for context continuity
const MEDIUM_LEN = 4000;         // characters for llms-medium.txt
const SMALL_LEN  = 1000;         // characters for llms-small.txt

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
  const baseName = originalName
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .substring(0, 40) || "document";

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

    archive.append(fullText, { name: `${baseName}/llms-full.txt` });
    archive.append(fullText.slice(0, MEDIUM_LEN), { name: `${baseName}/llms-medium.txt` });
    archive.append(fullText.slice(0, SMALL_LEN), { name: `${baseName}/llms-small.txt` });
    archive.append(JSON.stringify(metadata, null, 2), { name: `${baseName}/metadata.json` });
    archive.append(readme, { name: `${baseName}/README.md` });

    chunkTexts.forEach((chunk, i) => {
      const header = `[chunk:${i + 1}/${chunkTexts.length}] [source:${originalName}]\n\n`;
      archive.append(`${header}${chunk}`, {
        name: `${baseName}/chunks/chunk_${String(i).padStart(4, "0")}.txt`,
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
  fs.writeFileSync(path.join(folderPath, "llms-full.txt"),   text, "utf8");

  // ── 2. Medium & small summaries ───────────────────────────────────────────
  fs.writeFileSync(path.join(folderPath, "llms-medium.txt"), text.slice(0, MEDIUM_LEN), "utf8");
  fs.writeFileSync(path.join(folderPath, "llms-small.txt"),  text.slice(0, SMALL_LEN),  "utf8");

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
    archive.directory(folderPath, baseName);
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

module.exports = { convertPdf, buildRagZipBuffer, cleanup };
