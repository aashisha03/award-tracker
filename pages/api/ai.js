export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { type, query, existing, awardName, awardUrl, manuscriptText, manuscriptBase64, fileName } = req.body;

  let prompt;

  if (type === 'discover') {
    prompt = `Search the web for literary awards matching: "${query}"\n\nContext: indie publisher (Infinite Books), "White Mirror Stories" — SF/F short story collection.\nAlready tracking: ${existing}\n\nFind 3-5 NEW awards not in the list above. Return ONLY a JSON array (no markdown, no explanation):\n[{"name":"...","url":"...","notes":"2-3 sentences","deadline":"...","status":"researching"}]`;
  }
  else if (type === 'analyze') {
    prompt = `Search the web for submission guidelines for "${awardName}" at ${awardUrl}.\n\nWe are an indie publisher submitting "White Mirror Stories" (SF/F short stories).\n\nExtract: entry fees, physical copies needed + address, digital requirements, supporting docs, eligibility, deadlines.\n\nReturn ONLY a JSON array (max 8 items, no markdown):\n[{"id":"1","text":"Actionable requirement","done":false}]`;
  }
  else if (type === 'manuscript') {
    const content = manuscriptBase64
      ? [
          { type: 'image_url', image_url: { url: `data:application/pdf;base64,${manuscriptBase64}` } },
          { type: 'text', text: msPrompt(fileName) }
        ]
      : [{ type: 'text', text: `MANUSCRIPT TEXT:\n\n${manuscriptText}\n\n---\n\n${msPrompt(fileName)}` }];

    try {
      const response = await fetch('https://developer.osv.engineering/inference/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`
        },
        body: JSON.stringify({
          model: 'anthropic/claude-3-5-sonnet-latest',
          max_tokens: 2000,
          messages: [{ role: 'user', content }]
        })
      });
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      return res.json({ content: [{ type: 'text', text }] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
  else return res.status(400).json({ error: 'Invalid type' });

  try {
    const response = await fetch('https://developer.osv.engineering/inference/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-5-sonnet-latest',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    res.json({ content: [{ type: 'text', text }] });
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
