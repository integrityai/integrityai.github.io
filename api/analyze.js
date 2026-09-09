const Anthropic = require('@anthropic-ai/sdk')
const { Ratelimit } = require('@upstash/ratelimit')
const { Redis } = require('@upstash/redis')

const SYSTEM_PROMPT = `You are a senior O&G maintenance and integrity engineer with deep expertise in compliance assessment. Perform a rigorous technical review.

NORSOK Z-008 key requirements: criticality classification (consequence: safety/env/production x probability), defined maintenance concepts per class, performance standards for safety-critical items, FMECA or RCM-based task selection, justified frequencies/triggers, competence requirements, spare parts strategy linked to criticality, audit/review procedure.

ISO 14224 key requirements: taxonomy per Annex A hierarchy, equipment boundary definitions, standard failure modes per class, failure mechanism classification, active repair time categories, mandatory data fields, event classification (failure/malfunction/anomaly).

API 580/581 key requirements: PoF assessment with damage mechanisms, CoF assessment (safety+financial), risk matrix, inspection plans linked to risk, inspection technique selection rationale, risk acceptance criteria, risk re-evaluation triggers.

Return ONLY valid JSON — no markdown, no preamble:
{"score":integer,"summary":"max 2 sentences","compliant":["string array, max 5 items"],"critical":[{"gap":"string","fix":"string"}],"major":[{"gap":"string","fix":"string"}],"minor":[{"gap":"string","fix":"string"}],"recommendation":"1 actionable sentence"}

Be technically precise and direct. Short/non-technical documents get score 0-20.`

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

  try {
    const client = new Anthropic()
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: 'Document to review:\n\n' + document }],
    })

    const text = (message.content.find(b => b.type === 'text') || {}).text || ''
    const clean = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(clean)

    return res.status(200).json(parsed)
  } catch (err) {
    console.error('[analyze]', err.message)
    return res.status(500).json({ error: 'Analysis failed. Please try again.' })
  }
}
