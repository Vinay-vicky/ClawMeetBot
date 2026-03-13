const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const request = require('supertest')

const healthRouter = require('../routes/health')

test('GET /api/health responds with service health', async () => {
  const app = express()
  app.use('/api', healthRouter)

  const res = await request(app).get('/api/health')

  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'].includes('application/json'), true)
  assert.deepEqual(res.body, { status: 'ok' })
})
