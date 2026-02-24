export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { type, query, existing, awardName, awardUrl, manuscriptText, manuscriptBase64, fileName } = req.body;

  let messages;

  if (type === 'discover') {
    messages = [{ role: 'user', content:
      `Search for literary awards matching: "${query}"\n\nContext: indie publisher (Infinite Books), "White Mirror Stories" — SF/F short story collection.\nAlready tracking: ${existing}\n\nFind 3-5 NEW awards not in the list above. Return ONLY a JSON array:\n[{"name":"...","url":"...","notes":"2-3 sentences","deadline":"...","status":"researching"}]`
    }];
  }
  else if (type === 'analyze') {
    messages = [{ role: 'user', content:
      `Search submission guidelines for "${awardName}" at ${awardUrl}.\n\nWe are an indie publisher submitting "White Mirror Stories" (SF/F short stories).\n\nExtract: entry fees, physical copies needed + address, digital requirements, supporting docs, eligibility, deadlines.\n\nReturn ONLY a JSON array (max 8 items):\n[{"id":"1","text":"Actionable requirement","done":false}]`
    }];
  }
  else if (type === 'manuscript') {
    const content = manuscriptBase64
      ? [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: manuscriptBase64 } },
          { type: 'text', text: msPrompt(fileName) }
        ]
      : [{ type: 'text', text: `MANUSCRIPT:\n\n${manuscriptText}\n\n---\n\n${msPrompt(fileName)}` }];
    messages = [{ role: 'user', content }];
  }
  else return res.status(400).json({ error: 'Invalid type' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages
      })
    });
    const data = await response.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}

function msPrompt(fname) {
  return `Analyse this manuscript ("${fname}") for an indie publisher seeking literary awards.
Then search the web for 4-6 awards that best match this specific manuscript.
Return ONLY valid JSON (no markdown):
{"title":"...","genres":["..."],"themes":["..."],"style":"...","audience":"...","wordCount":"...","matchedAwards":[{"name":"...","url":"...","notes":"...","deadline":"...","matchReason":"...","status":"researching"}]}`;
}
