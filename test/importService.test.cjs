const test = require('node:test')
const assert = require('node:assert/strict')

const { detectSource, normalizeUrl, importFromUrl } = require('../services/importService')

test('detectSource identifies supported URL providers', () => {
  assert.equal(detectSource('https://drive.google.com/file/d/abc123/view?usp=sharing'), 'gdrive')
  assert.equal(detectSource('https://dropbox.com/s/xyz/doc.pdf?dl=0'), 'dropbox')
  assert.equal(detectSource('https://example.com/manual.pdf'), 'direct')
  assert.equal(detectSource('https://example.com/article'), 'unknown')
})

test('normalizeUrl converts Google Drive and Dropbox links to download-ready URLs', () => {
  assert.equal(
    normalizeUrl('https://drive.google.com/file/d/abc123/view?usp=sharing'),
    'https://drive.google.com/uc?export=download&id=abc123',
  )

  assert.equal(
    normalizeUrl('https://dropbox.com/s/xyz/doc.pdf?dl=0'),
    'https://dropbox.com/s/xyz/doc.pdf?dl=1',
  )
})

test('importFromUrl rejects unsupported links with user-friendly message', async () => {
  await assert.rejects(
    () => importFromUrl('https://example.com/not-a-pdf-page'),
    (err) => {
      assert.equal(err.status, 400)
      assert.match(err.message, /supported/i)
      return true
    },
  )
})

test('importFromUrl downloads and validates a direct PDF URL', async () => {
  const originalFetch = global.fetch
  const pdfBytes = Uint8Array.from(Buffer.from('%PDF-1.7 test payload'))

  global.fetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/guide.pdf',
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase()
        if (key === 'content-type') return 'application/pdf'
        if (key === 'content-length') return String(pdfBytes.length)
        if (key === 'content-disposition') return ''
        return null
      },
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(pdfBytes)
        controller.close()
      },
    }),
  })

  try {
    const result = await importFromUrl('https://example.com/guide.pdf', { maxBytes: 1024 * 1024 })
    assert.equal(result.source, 'direct')
    assert.equal(result.fileName, 'guide.pdf')
    assert.equal(Buffer.isBuffer(result.buffer), true)
    assert.equal(result.buffer.subarray(0, 5).toString('utf8'), '%PDF-')
  } finally {
    global.fetch = originalFetch
  }
})
