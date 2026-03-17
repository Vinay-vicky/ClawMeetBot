const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const express = require('express')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const request = require('supertest')

const processCalls = []
const savePdfImportCalls = []
const deletePdfImportCalls = []
const deleteChunksCalls = []
const recentPdfImports = []
const chunkRowsBySource = new Map()
const chunkRowsByName = new Map()
const sourceImportCountByKey = new Map()

const tempZipPath = path.join(os.tmpdir(), `clawmeet-test-import-${process.pid}.zip`)
fs.writeFileSync(tempZipPath, Buffer.from('mock zip output'))

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath)
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  }
}

mockModule('../services/dbService', {
  getRecentMeetings: async () => [],
  getPendingTasks: async () => [],
  getMeetingStats: async () => ({}),
  getTaskStats: async () => ({}),
  getMeetingAnalytics: async () => ({}),
  markTaskDone: async () => {},
  getAllMembers: async () => [],
  getTaskEngagementByPerson: async () => [],
  getUserByLinkToken: async () => null,
  getPersonalTasks: async () => [],
  getPersonalNotes: async () => [],
  getRecentPdfImports: async () => recentPdfImports,
  getPdfImportById: async (id) => recentPdfImports.find((row) => Number(row.id) === Number(id)) || null,
  deletePdfImportById: async (id, telegramId) => {
    deletePdfImportCalls.push({ id: Number(id), telegramId: String(telegramId) })
    const index = recentPdfImports.findIndex((row) => Number(row.id) === Number(id) && String(row.telegram_id) === String(telegramId))
    if (index === -1) return 0
    recentPdfImports.splice(index, 1)
    return 1
  },
  countPdfImportsBySource: async (sourceType, sourceId) => sourceImportCountByKey.get(`${sourceType}:${sourceId}`) ?? 0,
  getChunksBySource: async (sourceType, sourceId) => chunkRowsBySource.get(`${sourceType}:${sourceId}`) || [],
  getChunksBySourceName: async (sourceName, sourceType) => {
    const key = `${String(sourceName || '').toLowerCase()}:${String(sourceType || '').toLowerCase()}`
    return chunkRowsByName.get(key) || chunkRowsByName.get(`${String(sourceName || '').toLowerCase()}:`) || []
  },
  deleteChunksBySource: async (sourceType, sourceId) => {
    deleteChunksCalls.push({ sourceType, sourceId })
    return 2
  },
  getUserByTelegramId: async () => ({ telegram_id: '42', name: 'Test User' }),
  updateUserProfileSettings: async () => {},
  addPersonalTask: async () => {},
  donePersonalTask: async () => {},
  deletePersonalTask: async () => {},
  updatePersonalTask: async () => {},
  addPersonalNote: async () => {},
  deletePersonalNote: async () => {},
  updatePersonalNote: async () => {},
  savePdfImport: async (record) => {
    savePdfImportCalls.push(record)
    return 77
  },
})

mockModule('../services/calendarService', {
  getScheduledMeetings: async () => [],
})

mockModule('../services/telegramService', {
  getTelegramProfilePhotoFileUrl: async () => null,
})

mockModule('../services/cloudinaryService', {
  isCloudinaryConfigured: () => false,
  uploadProfileImageDataUrl: async () => ({ secureUrl: '', publicId: '' }),
  deleteImageByPublicId: async () => {},
})

mockModule('../services/pdfIngestionService', {
  DASHBOARD_PDF_MAX_BYTES: 50 * 1024 * 1024,
  ensurePdfFileName: (value) => {
    const trimmed = String(value || 'document.pdf').trim() || 'document.pdf'
    return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`
  },
  formatBytes: () => '50 MB',
  isProbablyPdf: (buffer) => Buffer.isBuffer(buffer) && buffer.subarray(0, 5).toString('utf8') === '%PDF-',
  downloadPdfFromUrl: async (url) => ({
    buffer: Buffer.from('%PDF-url-import'),
    fileName: 'remote.pdf',
    contentType: 'application/pdf',
    url,
  }),
  processPdfBuffer: async (buffer, fileName, options) => {
    processCalls.push({ buffer: Buffer.from(buffer), fileName, options })
    return {
      zipPath: 'tmp/fake.zip',
      meta: { pages: 12, chunks: 34, chars: 5678 },
      indexedChunks: 34,
      sourceId: 'mock-source',
      sourceName: fileName,
    }
  },
})

mockModule('../services/pdfLLMService', {
  buildRagZipBuffer: async () => ({ zipBuffer: Buffer.from('mock regenerated zip output') }),
  cleanup: () => {},
})

mockModule('../utils/logger', {
  info: () => {},
  warn: () => {},
  error: () => {},
})

delete require.cache[require.resolve('../routes/dashboard')]
const dashboardRouter = require('../routes/dashboard')

function sessionCookie(telegramId, name = 'Test User') {
  const payload = Buffer.from(JSON.stringify({ tid: String(telegramId), name })).toString('base64url')
  const signature = crypto.createHmac('sha256', 'clawmeet-session-2026').update(payload).digest('hex')
  return `cmbt=${payload}.${signature}`
}

function buildApp() {
  const app = express()
  app.use('/dashboard', dashboardRouter)
  app.use((err, _req, res, _next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ error: 'Request body too large' })
    }
    return res.status(err?.status || 500).json({ error: err?.message || 'Internal error' })
  })
  return app
}

function binaryParser(res, callback) {
  const chunks = []
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  res.on('end', () => callback(null, Buffer.concat(chunks)))
}

test('POST /dashboard/api/me/pdf-upload imports a PDF for an authenticated user', async () => {
  processCalls.length = 0
  savePdfImportCalls.length = 0
  deletePdfImportCalls.length = 0
  deleteChunksCalls.length = 0
  sourceImportCountByKey.clear()

  const app = buildApp()
  const res = await request(app)
    .post('/dashboard/api/me/pdf-upload?fileName=' + encodeURIComponent('team-handbook.pdf'))
    .set('Cookie', sessionCookie(42))
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from('%PDF-1.7 mock upload'))

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.status, 'completed')
  assert.equal(res.body.mode, 'upload')
  assert.equal(res.body.importId, 77)
  assert.equal(res.body.fileName, 'team-handbook.pdf')
  assert.equal(res.body.indexedChunks, 34)
  assert.equal(res.body.downloadPath, '/dashboard/api/me/pdf-imports/77/download')
  assert.equal(res.body.pipeline?.current, 'completed')
  assert.equal(processCalls.length, 1)
  assert.equal(savePdfImportCalls.length, 1)
  assert.equal(processCalls[0].fileName, 'team-handbook.pdf')
  assert.equal(processCalls[0].options.sourceType, 'pdf_upload')
  assert.equal(savePdfImportCalls[0].fileName, 'team-handbook.pdf')
  assert.equal(savePdfImportCalls[0].sourceMode, 'upload')
  assert.equal(savePdfImportCalls[0].zipPath, 'tmp/fake.zip')
})

test('POST /dashboard/api/me/pdf-url imports a remote PDF for an authenticated user', async () => {
  processCalls.length = 0
  savePdfImportCalls.length = 0
  deletePdfImportCalls.length = 0
  deleteChunksCalls.length = 0
  sourceImportCountByKey.clear()

  const app = buildApp()
  const res = await request(app)
    .post('/dashboard/api/me/pdf-url')
    .set('Cookie', sessionCookie(42))
    .send({ url: 'https://example.com/remote.pdf' })

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.status, 'completed')
  assert.equal(res.body.mode, 'url')
  assert.equal(res.body.importId, 77)
  assert.equal(res.body.fileName, 'remote.pdf')
  assert.equal(res.body.indexedChunks, 34)
  assert.equal(res.body.downloadPath, '/dashboard/api/me/pdf-imports/77/download')
  assert.equal(res.body.pipeline?.current, 'completed')
  assert.equal(processCalls.length, 1)
  assert.equal(savePdfImportCalls.length, 1)
  assert.equal(processCalls[0].fileName, 'remote.pdf')
  assert.equal(processCalls[0].options.sourceType, 'pdf_url')
  assert.equal(savePdfImportCalls[0].sourceMode, 'url')
  assert.equal(savePdfImportCalls[0].sourceUrl, 'https://example.com/remote.pdf')
})

test('POST /dashboard/api/me/pdf-upload rejects unauthenticated requests', async () => {
  const app = buildApp()
  const res = await request(app)
    .post('/dashboard/api/me/pdf-upload')
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from('%PDF-1.7 mock upload'))

  assert.equal(res.status, 401)
  assert.deepEqual(res.body, { error: 'Not authenticated' })
})

test('GET /dashboard/api/me includes recent PDF imports with download availability', async () => {
  recentPdfImports.length = 0
  chunkRowsBySource.clear()
  chunkRowsByName.clear()
  deletePdfImportCalls.length = 0
  deleteChunksCalls.length = 0
  sourceImportCountByKey.clear()
  recentPdfImports.push({
    id: 91,
    telegram_id: '42',
    file_name: 'handbook.pdf',
    download_name: 'handbook-rag-docs.zip',
    source_mode: 'upload',
    source_url: '',
    source_type: 'pdf_upload',
    source_id: 'source-91',
    pages: 12,
    chunks: 34,
    chars: 5678,
    indexed_chunks: 34,
    zip_path: '',
    created_at: '2026-03-17 10:20:30',
  })

  chunkRowsBySource.set('pdf_upload:source-91', [
    { chunk_text: 'Chunk for regular source-id lookup' },
  ])

  const app = buildApp()
  const res = await request(app)
    .get('/dashboard/api/me')
    .set('Cookie', sessionCookie(42))

  assert.equal(res.status, 200)
  assert.equal(Array.isArray(res.body.imports), true)
  assert.equal(res.body.imports.length, 1)
  assert.equal(res.body.imports[0].id, 91)
  assert.equal(res.body.imports[0].zipAvailable, true)
  assert.equal(res.body.imports[0].downloadPath, '/dashboard/api/me/pdf-imports/91/download')
})

test('GET /dashboard/api/me/pdf-imports/:id/download streams the saved ZIP output', async () => {
  recentPdfImports.length = 0
  chunkRowsBySource.clear()
  chunkRowsByName.clear()
  deletePdfImportCalls.length = 0
  deleteChunksCalls.length = 0
  sourceImportCountByKey.clear()
  recentPdfImports.push({
    id: 92,
    telegram_id: '42',
    file_name: 'remote.pdf',
    download_name: 'remote-rag-docs.zip',
    source_mode: 'url',
    source_url: 'https://example.com/remote.pdf',
    source_type: 'pdf_url',
    source_id: 'source-92',
    pages: 5,
    chunks: 11,
    chars: 1200,
    indexed_chunks: 11,
    zip_path: '',
    created_at: '2026-03-17 10:21:30',
  })

  chunkRowsBySource.set('pdf_url:source-92', [
    { chunk_text: 'First indexed chunk for regenerated ZIP output.' },
    { chunk_text: 'Second indexed chunk for regenerated ZIP output.' },
  ])

  const app = buildApp()
  const res = await request(app)
    .get('/dashboard/api/me/pdf-imports/92/download')
    .set('Cookie', sessionCookie(42))
    .buffer(true)
    .parse(binaryParser)

  assert.equal(res.status, 200)
  assert.equal(String(res.headers['content-disposition']).includes('remote-rag-docs.zip'), true)
  assert.equal(String(res.headers['content-type']).includes('application/zip'), true)
  assert.equal(Buffer.isBuffer(res.body), true)
  assert.equal(res.body.length > 0, true)
})

test('GET /dashboard/api/me/pdf-imports/:id/download falls back to source-name lookup for legacy imports', async () => {
  recentPdfImports.length = 0
  chunkRowsBySource.clear()
  chunkRowsByName.clear()
  deletePdfImportCalls.length = 0
  deleteChunksCalls.length = 0
  sourceImportCountByKey.clear()

  recentPdfImports.push({
    id: 1,
    telegram_id: '42',
    file_name: 'legacy.pdf',
    download_name: 'legacy-rag-docs.zip',
    source_mode: 'upload',
    source_url: '',
    source_type: '',
    source_id: '',
    pages: 3,
    chunks: 7,
    chars: 900,
    indexed_chunks: 7,
    zip_path: '',
    created_at: '2026-03-17 09:00:00',
  })

  chunkRowsByName.set('legacy.pdf:', [
    { chunk_text: 'Recovered chunk via source-name fallback.' },
  ])

  const app = buildApp()
  const res = await request(app)
    .get('/dashboard/api/me/pdf-imports/1/download')
    .set('Cookie', sessionCookie(42))
    .buffer(true)
    .parse(binaryParser)

  assert.equal(res.status, 200)
  assert.equal(String(res.headers['content-disposition']).includes('legacy-rag-docs.zip'), true)
  assert.equal(String(res.headers['content-type']).includes('application/zip'), true)
  assert.equal(Buffer.isBuffer(res.body), true)
  assert.equal(res.body.length > 0, true)
})

test('DELETE /dashboard/api/me/pdf-imports/:id deletes import and removes chunks when unshared', async () => {
  recentPdfImports.length = 0
  chunkRowsBySource.clear()
  chunkRowsByName.clear()
  deletePdfImportCalls.length = 0
  deleteChunksCalls.length = 0
  sourceImportCountByKey.clear()

  recentPdfImports.push({
    id: 123,
    telegram_id: '42',
    file_name: 'delete-me.pdf',
    download_name: 'delete-me-rag-docs.zip',
    source_mode: 'upload',
    source_url: '',
    source_type: 'pdf_upload',
    source_id: 'source-delete',
    pages: 2,
    chunks: 4,
    chars: 400,
    indexed_chunks: 4,
    zip_path: '',
    created_at: '2026-03-17 11:00:00',
  })
  sourceImportCountByKey.set('pdf_upload:source-delete', 0)

  const app = buildApp()
  const res = await request(app)
    .delete('/dashboard/api/me/pdf-imports/123')
    .set('Cookie', sessionCookie(42))
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'fetch')

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.deletedImportId, 123)
  assert.equal(deletePdfImportCalls.length, 1)
  assert.equal(deleteChunksCalls.length, 1)
  assert.equal(deleteChunksCalls[0].sourceType, 'pdf_upload')
  assert.equal(deleteChunksCalls[0].sourceId, 'source-delete')
})

test('DELETE /dashboard/api/me/pdf-imports/:id keeps chunks when source still referenced', async () => {
  recentPdfImports.length = 0
  chunkRowsBySource.clear()
  chunkRowsByName.clear()
  deletePdfImportCalls.length = 0
  deleteChunksCalls.length = 0
  sourceImportCountByKey.clear()

  recentPdfImports.push({
    id: 124,
    telegram_id: '42',
    file_name: 'shared.pdf',
    download_name: 'shared-rag-docs.zip',
    source_mode: 'upload',
    source_url: '',
    source_type: 'pdf_upload',
    source_id: 'source-shared',
    pages: 2,
    chunks: 4,
    chars: 400,
    indexed_chunks: 4,
    zip_path: '',
    created_at: '2026-03-17 11:10:00',
  })
  sourceImportCountByKey.set('pdf_upload:source-shared', 2)

  const app = buildApp()
  const res = await request(app)
    .delete('/dashboard/api/me/pdf-imports/124')
    .set('Cookie', sessionCookie(42))
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'fetch')

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.deletedImportId, 124)
  assert.equal(deletePdfImportCalls.length, 1)
  assert.equal(deleteChunksCalls.length, 0)
})
