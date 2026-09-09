const Anthropic = require('@anthropic-ai/sdk')
const { Ratelimit } = require('@upstash/ratelimit')
const { Redis } = require('@upstash/redis')

const SYSTEM_PROMPT = `You are a senior O&G maintenance and integrity engineer with deep expertise in compliance assessment. Perform a rigorous technical review of the submitted document.

NORSOK Z-008 key requirements: criticality classification (consequence: safety/env/production x probability), defined maintenance concepts per class, performance standards for safety-critical items, FMECA or RCM-based task selection, justified frequencies/triggers, competence requirements, spare parts strategy linked to criticality, audit/review procedure.

ISO 14224 key requirements: taxonomy per Annex A hierarchy, equipment boundary definitions, standard failure modes per class, failure mechanism classification, active repair time categories, mandatory data fields, event classification (failure/malfunction/anomaly).

API 580/581 key requirements: PoF assessment with damage mechanisms, CoF assessment (safety+financial), risk matrix, inspection plans linked to risk, inspection technique selection rationale, risk acceptance criteria, risk re-evaluation triggers.

Be technically precise and direct. Short/non-technical documents score 0-20.
Each "gap" and "fix" field must be one sentence maximum. "summary" max 2 sentences. "recommendation" max 1 sentence.`

// Tool schema forces structured output — Anthropic guarantees valid JSON, no JSON.parse needed.
const RESULT_TOOL = {
  name: 'compliance_result',
  description: 'Submit the structured compliance assessment result.',
  input_schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', description: 'Compliance score 0-100' },
      summary: { type: 'string', description: 'Max 2 sentences summarising overall compliance level' },
      compliant: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 5 areas where the document meets requirements',
      },
      critical: {
        type: 'array',
        items: {
          type: 'object',
          properties: { gap: { type: 'string' }, fix: { type: 'string' } },
          required: ['gap', 'fix'],
        },
      },
      major: {
        type: 'array',
        items: {
          type: 'object',
          properties: { gap: { type: 'string' }, fix: { type: 'string' } },
          required: ['gap', 'fix'],
        },
      },
      minor: {
        type: 'array',
        items: {
          type: 'object',
          properties: { gap: { type: 'string' }, fix: { type: 'string' } },
          required: ['gap', 'fix'],
        },
      },
      recommendation: { type: 'string', description: '1 actionable sentence' },
    },
    required: ['score', 'summary', 'compliant', 'critical', 'major', 'minor', 'recommendation'],
  },
}

const MIN_DOC = 30
const MAX_DOC = 15000

const ALLOWED_ORIGINS = new Set(
  ['https://integrityai.github.io', process.env.ALLOWED_ORIGIN].filter(Boolean)
)

// ponytail: lazy-init so the Redis client is reused across warm invocations
let ratelimit = null

function getRatelimit() {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null
  if (!ratelimit) {
    ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, '1 h'),
    })
  }
  return ratelimit
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin
  const originAllowed = origin && ALLOWED_ORIGINS.has(origin)

  if (originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Vary', 'Origin')
  }

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (origin && !originAllowed) return res.status(403).json({ error: 'Forbidden' })

  const { document } = req.body || {}
  if (!document || typeof document !== 'string') {
    return res.status(400).json({ error: 'Missing document' })
  }
  if (document.length < MIN_DOC) {
    return res.status(400).json({ error: 'Document too short (min 30 characters)' })
  }
  if (document.length > MAX_DOC) {
    return res.status(400).json({ error: 'Document too long (max 15 000 characters)' })
  }

  const rl = getRatelimit()
  if (rl) {
    const ip = (req.headers['x-forwarded-for'] || '127.0.0.1').split(',')[0].trim()
    const { success } = await rl.limit(ip)
    if (!success) {
      return res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' })
    }
  }

  console.log('[analyze] doc length:', document.length)

  try {
    const client = new Anthropic()
    console.time('[analyze] anthropic')
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [RESULT_TOOL],
      tool_choice: { type: 'tool', name: 'compliance_result' },
      messages: [{ role: 'user', content: 'Document to review:\n\n' + document }],
    })
    console.timeEnd('[analyze] anthropic')

    console.log('[analyze] stop_reason:', message.stop_reason)
    if (message.stop_reason === 'max_tokens') {
      throw new Error('Response was truncated — reduce document length or retry')
    }

    const toolUse = message.content.find(b => b.type === 'tool_use' && b.name === 'compliance_result')
    if (!toolUse) throw new Error('Model did not return structured result')

    console.log('[analyze] tool result:', JSON.stringify(toolUse.input))
    return res.status(200).json(toolUse.input)
  } catch (err) {
    console.error('[analyze]', err.message)
    return res.status(500).json({ error: 'Analysis failed. Please try again.' })
  }
}
