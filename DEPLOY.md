# Deploy — Compliance Checker API

The frontend (`IntegrityAI_Compliance_Checker.html`) lives on GitHub Pages.  
The backend (`api/analyze.js`) is a Vercel serverless function in the same repo.

---

## 1 — Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com) → sign up / log in.
2. API Keys → Create Key. Copy it immediately (shown only once).
3. Add a small spend limit under Billing → Spend Limits (e.g. $10/month) to cap cost.

---

## 2 — Set up Upstash Redis (rate limiting — free)

> Skip this if you don't need rate limiting yet. The function works without it.

1. Go to [console.upstash.com](https://console.upstash.com) → create a free account.
2. Create Database → choose **Redis** → region closest to your users → Free tier.
3. In the database dashboard, copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

## 3 — Deploy to Vercel

### First time

1. Go to [vercel.com](https://vercel.com) → sign up with GitHub (free Hobby plan).
2. New Project → Import the `integrityai.github.io` repository.
3. Framework Preset: **Other** (no build command, no output directory).
4. Add environment variables (before clicking Deploy):

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `UPSTASH_REDIS_REST_URL` | from Upstash (optional) |
| `UPSTASH_REDIS_REST_TOKEN` | from Upstash (optional) |
| `ALLOWED_ORIGIN` | future custom domain, e.g. `https://integrityai.io` (optional) |

5. Click **Deploy**.

Vercel assigns a URL like `https://integrityai-xxxx.vercel.app`.  
If the project name is set to `integrityai` it will be `https://integrityai.vercel.app`.

### Update the frontend URL

Open `IntegrityAI_Compliance_Checker.html` and set `API_URL` at the top of the script to your actual Vercel URL:

```js
const API_URL = 'https://YOUR-PROJECT.vercel.app/api/analyze';
```

Commit and push — GitHub Pages picks it up automatically.

### Future deploys

Just push to `main`. Vercel redeploys automatically via the GitHub integration.

---

## 4 — Test before going live

### Quick curl test (no browser needed)

```bash
curl -X POST https://integrityai.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"document":"This maintenance strategy covers centrifugal compressors with annual PM intervals and corrective maintenance on failure. Spare parts held in warehouse. No criticality classification applied."}'
```

Expected: a JSON object with `score`, `summary`, `critical`, `major`, `minor`, `compliant`, `recommendation`.

### Local test with Vercel CLI

```bash
npm i -g vercel
vercel dev
```

Then hit `http://localhost:3000/api/analyze` with the curl command above.  
Set env vars locally in a `.env` file (never commit it):

```
ANTHROPIC_API_KEY=sk-ant-...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

---

## Free tier limits (comfortable for dozens of analyses/day)

| Service | Free allowance |
|---------|---------------|
| Vercel Hobby | 100 GB-hrs compute/month, 100k function invocations/day |
| Upstash Redis | 10,000 requests/day, 256 MB storage |
| Anthropic | Pay-per-use (no free tier — set a spend cap) |

At ~$0.003 per analysis (1000 input + 1000 output tokens with claude-sonnet-4-6), 100 analyses/day ≈ $9/month maximum.
