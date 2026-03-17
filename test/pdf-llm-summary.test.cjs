const test = require('node:test')
const assert = require('node:assert/strict')

const servicePath = require.resolve('../services/pdfLLMService')

delete require.cache[servicePath]
const { generateLlmContextVariants } = require('../services/pdfLLMService')

test('generateLlmContextVariants creates structured fallback summaries without AI keys', async () => {
  const prev = {
    KIMI_API_KEY: process.env.KIMI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    PDF_LLM_USE_AI_SUMMARY: process.env.PDF_LLM_USE_AI_SUMMARY,
  }

  process.env.KIMI_API_KEY = ''
  process.env.OPENAI_API_KEY = ''
  process.env.GROQ_API_KEY = ''
  process.env.GEMINI_API_KEY = ''
  process.env.PDF_LLM_USE_AI_SUMMARY = 'false'

  const sample = [
    'GOVERNMENT OF TAMIL NADU MATHEMATICS.indd',
    'Page 12',
    'Chapter 1: Diversity in society explains the social and cultural fabric of regions in India.',
    'People from different languages, food habits, and traditions coexist and build a shared identity.',
    'The chapter introduces concepts like inclusion, cooperation, and the need for constitutional values.',
    'Examples include festivals, local governance participation, and school-level collaboration.',
    'The text discusses equality, social justice, and practical civic responsibilities for students.',
    'Chapter 2: Governance and public institutions describes Panchayat, Municipality, and State responsibilities.',
    'It connects decision making, budgeting, and public welfare with citizen participation and accountability.',
    'A section on rights and duties explains why participation in civic systems improves outcomes.',
    'Case studies compare communities with active participation versus passive participation.',
    'Final notes emphasize empathy, cooperation, and informed decision making in public life.',
  ].join('\n\n')

  const variants = await generateLlmContextVariants(sample)

  assert.equal(typeof variants.llms, 'string')
  assert.equal(typeof variants.full, 'string')
  assert.equal(typeof variants.medium, 'string')
  assert.equal(typeof variants.small, 'string')

  assert.ok(variants.full.length > 200)
  assert.equal(variants.full.includes('.indd'), false)
  assert.equal(/\bPage\s*\d+\b/i.test(variants.full), false)
  assert.ok(variants.medium.includes('## Overview') || variants.medium.includes('## Summary'))
  assert.ok(variants.small.includes('## Overview') || variants.small.includes('Quick LLM Brief') || variants.small.includes('## Key Points'))
  assert.ok(variants.small.length <= variants.medium.length)

  process.env.KIMI_API_KEY = prev.KIMI_API_KEY
  process.env.OPENAI_API_KEY = prev.OPENAI_API_KEY
  process.env.GROQ_API_KEY = prev.GROQ_API_KEY
  process.env.GEMINI_API_KEY = prev.GEMINI_API_KEY
  process.env.PDF_LLM_USE_AI_SUMMARY = prev.PDF_LLM_USE_AI_SUMMARY
})
