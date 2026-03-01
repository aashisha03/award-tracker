export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

const OSV_URL = 'https://developer.osv.engineering/inference/v1/chat/completions';
const MODEL   = 'anthropic/claude-sonnet-4-5-20250929';
const SYSTEM  = 'You are a helpful assistant. Always respond with valid JSON only. No markdown, no code fences, no explanation. Just the raw JSON.';

// ── Shared fetch helper ────────────────────────────────────────────────────────
// Throws a descriptive error when the OSV API returns a non-2xx status,
// which previously caused `choices?.[0]?.message?.content` to silently become
// undefined → JSON.parse('') → SyntaxError → frontend catch block fires.
async function callOSV(messages, includeSystem = true) {
  const body = {
    model: MODEL,
    max_tokens: 2000,
    messages: includeSystem
      ? [{ role: 'system', content: SYSTEM }, ...messages]
      : messages,
  };

  const response = await fetch(OSV_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  // ── This was the missing check. Without it, error responses (401, 429, 500)
  //    were silently parsed as empty text, breaking every downstream JSON.parse.
  if (!response.ok) {
    const errBody = await response.text().catch(() => '(unreadable)');
    throw new Error(`OSV API returned ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error(`OSV API returned empty content. Full response: ${JSON.stringify(data)}`);
  }

  return text;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel environment variables.' });
  }

  const {
    type,
    query, existing,
    awardName, awardUrl,
    manuscriptText, manuscriptBase64,
    fileName,
  } = req.body;

  try {
    // ── Award Discovery ────────────────────────────────────────────────────
    if (type === 'discover') {
      const prompt =
        `Find literary awards matching: "${query}"\n\n` +
        `Context: indie publisher (Infinite Books), "White Mirror Stories" — SF/F short story collection.\n` +
        `Already tracking: ${existing || 'none'}\n\n` +
        `Return 3–5 NEW awards not already in the list above.\n` +
        `JSON array only:\n` +
        `[{"name":"...","url":"...","notes":"2-3 sentences on eligibility","deadline":"..."}]`;

      const text = await callOSV([{ role: 'user', content: prompt }]);
      return res.json({ content: [{ type: 'text', text }] });
    }

    // ── Award Requirements Analysis ────────────────────────────────────────
    if (type === 'analyze') {
      const prompt =
        `List submission requirements for the literary award "${awardName}"` +
        (awardUrl ? ` (${awardUrl})` : '') + `.\n\n` +
        `Publisher context: indie (Infinite Books), submitting "White Mirror Stories" (SF/F short stories).\n` +
        `Include: entry fees, physical copy requirements + mailing address, digital format, ` +
        `supporting docs, eligibility rules, deadlines.\n\n` +
        `JSON array, max 8 items:\n` +
        `[{"id":"1","text":"Specific actionable requirement","done":false}]`;

      const text = await callOSV([{ role: 'user', content: prompt }]);
      return res.json({ content: [{ type: 'text', text }] });
    }

    // ── Manuscript Analysis ────────────────────────────────────────────────
    if (type === 'manuscript') {
      let content;

      if (manuscriptBase64) {
        // Send PDF as base64 image — works with vision-capable Claude models
        // via OpenAI-compatible proxy. If your proxy does not support PDFs,
        // upload the file as DOCX instead (which uses the text path below).
        content = [
          {
            type: 'image_url',
            image_url: { url: `data:application/pdf;base64,${manuscriptBase64}` },
          },
          { type: 'text', text: msPrompt(fileName) },
        ];
      } else {
        // DOCX path: text was extracted client-side via mammoth
        content = [{
          type: 'text',
          text: `MANUSCRIPT TEXT:\n\n${manuscriptText}\n\n---\n\n${msPrompt(fileName)}`,
        }];
      }

      // System prompt omitted for vision messages (some proxies reject it with multimodal)
      const text = await callOSV([{ role: 'user', content }], false);
      return res.json({ content: [{ type: 'text', text }] });
    }

    return res.status(400).json({ error: `Unknown type: "${type}"` });

  } catch (e) {
    console.error(`[api/ai] type="${type}" error:`, e.message);
    return res.status(500).json({ error: e.message });
  }
}

function msPrompt(fname) {
  return (
    `Analyse this manuscript ("${fname}") for an indie publisher seeking literary awards.\n` +
    `Then suggest 4–6 real awards that best match its genre, themes, length, and publisher type.\n\n` +
    `Return ONLY valid JSON (no markdown fences):\n` +
    `{"title":"...","genres":["..."],"themes":["..."],"style":"...","audience":"...",` +
    `"wordCount":"...","matchedAwards":[{"name":"...","url":"...","notes":"...",` +
    `"deadline":"...","matchReason":"..."}]}`
  );
}
