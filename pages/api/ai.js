export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const SEARCH_URL = 'https://developer.osv.engineering/alpha/web/search';
const CRAWL_URL  = 'https://developer.osv.engineering/web/crawl';
const EXTRACT_URL = 'https://developer.osv.engineering/web/extract';

// ── Shared helpers ─────────────────────────────────────────────────────────────

async function callClaude(messages, systemPrompt, maxTokens = 1500) {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt || 'You are a helpful assistant. Always respond with valid JSON only. No markdown fences, no explanation.',
    messages,
  };
  const r = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '(unreadable)');
    throw new Error(`Claude API ${r.status}: ${t}`);
  }
  const data = await r.json();
  const text = data.content?.find(b => b.type === 'text')?.text;
  if (!text) throw new Error('Claude returned empty content');
  return text;
}

async function searchWeb(query, categories = 'general', engines = 'google,bing,duckduckgo') {
  const params = new URLSearchParams({ q: query, format: 'json', categories, engines, language: 'en-US' });
  const r = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Authorization: `Bearer ${process.env.OSV_API_KEY}` },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '(unreadable)');
    throw new Error(`Search API ${r.status}: ${t}`);
  }
  return r.json(); // { results: [{title, url, content}], ... }
}

async function crawlSite(url) {
  const r = await fetch(CRAWL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OSV_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      limit: 8,
      depth: 2,
      format: 'text',
      strategy: 'auto',
      mode: 'scrape',
      blockAssets: true,
    }),
  });
  if (!r.ok) {
    // Non-fatal: fall back to extract
    return null;
  }
  const data = await r.json();
  // Concatenate text from all crawled pages (up to ~12k chars)
  return (data.items || [])
    .map(p => p.contents || '')
    .join('\n\n')
    .slice(0, 12000);
}

async function extractPage(url) {
  const r = await fetch(EXTRACT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OSV_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      format: 'text',
      strategy: 'auto',
      extract: { features: ['mainContent', 'readability', 'cleanHtml'] },
    }),
  });
  if (!r.ok) return '';
  const data = await r.json();
  return (data.contents || '').slice(0, 12000);
}

async function getAwardPageText(url) {
  try {
    const crawled = await crawlSite(url);
    if (crawled && crawled.length > 200) return crawled;
    // Fallback to single-page extract
    return await extractPage(url);
  } catch {
    try { return await extractPage(url); } catch { return ''; }
  }
}

function safeParseJSON(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) return JSON.parse(arrMatch[0]);
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
    throw new Error('Could not parse JSON from Claude response');
  }
}

// ── Pipeline steps ─────────────────────────────────────────────────────────────

// STEP 1: Extract book metadata + search query categories from description/manuscript
async function step1_analyzeBook(input) {
  const prompt = `You are a literary expert. Analyze this book description/manuscript excerpt and produce search queries for finding relevant literary awards.

INPUT:
${input.slice(0, 8000)}

Return JSON only:
{
  "title": "book title or 'Unknown'",
  "genres": ["genre1", "genre2"],
  "themes": ["theme1", "theme2"],
  "audience": "target audience",
  "wordCount": "estimated or 'Unknown'",
  "style": "brief style description",
  "searchQueries": [
    "indie publisher science fiction short story award 2025 2026",
    "fantasy short fiction literary prize open submissions",
    "speculative fiction award independent press"
  ]
}

Generate 4-6 targeted search queries that would find real literary awards matching this book's genre, themes, publisher type (indie), and format.`;

  const text = await callClaude([{ role: 'user', content: prompt }], null, 1200);
  return safeParseJSON(text);
}

// STEP 1b: For discover mode, generate search queries from a user query string
async function step1b_discoverQueries(query) {
  const prompt = `Generate 4-6 targeted web search queries to find literary awards matching this description: "${query}"
Context: indie publisher (Infinite Books), "White Mirror Stories" — SF/F short story collection.

Return JSON array of search query strings only:
["query1", "query2", "query3", "query4"]

Make queries specific: include award type, genre, year (2025 or 2026), submission status.`;

  const text = await callClaude([{ role: 'user', content: prompt }], null, 600);
  return safeParseJSON(text);
}

// STEP 2: Search the web for each query, collect raw results
async function step2_searchAwards(queries) {
  const allResults = [];
  const seen = new Set();
  for (const q of queries) {
    try {
      const data = await searchWeb(q, 'general');
      for (const r of (data.results || []).slice(0, 6)) {
        if (!seen.has(r.url)) {
          seen.add(r.url);
          allResults.push({ title: r.title, url: r.url, snippet: r.content });
        }
      }
    } catch (e) {
      console.warn(`Search failed for query "${q}":`, e.message);
    }
  }
  return allResults; // raw search hits, may include non-award pages
}

// STEP 3: Claude filters search results to identify real award pages
async function step3_filterAwards(searchResults, bookMeta, existing) {
  const prompt = `You are a literary awards expert. Here are web search results that may contain literary award opportunities.

BOOK CONTEXT:
- Title: ${bookMeta.title || 'White Mirror Stories'}
- Genres: ${(bookMeta.genres || ['SF/F', 'Short Stories']).join(', ')}
- Publisher: Indie (Infinite Books)
- Format: Short story collection

ALREADY TRACKING (exclude these): ${existing || 'none'}

SEARCH RESULTS:
${JSON.stringify(searchResults.slice(0, 30), null, 2)}

Select 3-6 results that are REAL literary award opportunities (not listicles, not blogs about awards, not eligibility guides). For each, produce:
[
  {
    "name": "Official Award Name",
    "url": "direct URL to the award/submission page",
    "notes": "2-3 sentences on eligibility and fit for this book",
    "deadline": "deadline if visible in snippet, else 'Check website'"
  }
]

Only include awards that genuinely accept indie-published or small-press short fiction/SF/F. Return JSON array only.`;

  const text = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  return safeParseJSON(text);
}

// STEP 4: Crawl each award site and extract submission requirements via Claude
async function step4_extractRequirements(award) {
  const pageText = await getAwardPageText(award.url);

  if (!pageText || pageText.length < 100) {
    // No crawl data — Claude uses its knowledge
    const prompt = `List submission requirements for the literary award "${award.name}" (${award.url}).
Publisher: indie (Infinite Books). Book: "White Mirror Stories" (SF/F short stories).
Include: entry fees, physical/digital submission format, word count limits, eligibility rules, deadline, supporting docs.
JSON array, max 8 items: [{"id":"1","text":"Specific actionable requirement","done":false}]`;
    const text = await callClaude([{ role: 'user', content: prompt }], null, 1000);
    return safeParseJSON(text);
  }

  const prompt = `You have crawled the website for the literary award "${award.name}".

CRAWLED CONTENT:
${pageText}

Extract all submission requirements and process details relevant to an indie publisher submitting "White Mirror Stories" (SF/F short story collection).

Include: entry fees, physical copy requirements + mailing address, digital format specs, word count limits, eligibility rules, important deadlines, required supporting documents, judge/jury info if present.

Return JSON array, max 10 items:
[{"id":"1","text":"Specific actionable requirement or step","done":false}]

Return JSON only.`;

  const text = await callClaude([{ role: 'user', content: prompt }], null, 1200);
  return safeParseJSON(text);
}

// ── Main handler ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set.' });
  }

  const { type, query, existing, awardName, awardUrl, manuscriptText, fileName } = req.body;

  try {

    // ── DISCOVER: User types a description → full pipeline ─────────────────
    if (type === 'discover') {
      // 1. Generate search queries
      const queries = await step1b_discoverQueries(query);
      console.log('[discover] queries:', queries);

      // 2. Search the web
      const rawResults = await step2_searchAwards(Array.isArray(queries) ? queries : [query]);
      console.log('[discover] raw results:', rawResults.length);

      // 3. Filter with Claude
      const filtered = await step3_filterAwards(rawResults, { title: 'White Mirror Stories', genres: ['Science Fiction', 'Fantasy', 'Short Stories'] }, existing);
      console.log('[discover] filtered awards:', filtered.length);

      return res.json({ content: [{ type: 'text', text: JSON.stringify(filtered) }] });
    }

    // ── ANALYZE: Fetch & extract requirements for a known award ────────────
    if (type === 'analyze') {
      const reqs = await step4_extractRequirements({ name: awardName, url: awardUrl });
      return res.json({ content: [{ type: 'text', text: JSON.stringify(reqs) }] });
    }

    // ── MANUSCRIPT: Full pipeline from uploaded manuscript ─────────────────
    if (type === 'manuscript') {
      // 1. Analyze book
      const bookMeta = await step1_analyzeBook(manuscriptText || '');
      console.log('[manuscript] bookMeta:', bookMeta.title, bookMeta.genres);

      // 2. Search
      const rawResults = await step2_searchAwards(bookMeta.searchQueries || ['literary award short fiction indie publisher']);
      console.log('[manuscript] raw results:', rawResults.length);

      // 3. Filter
      const filteredAwards = await step3_filterAwards(rawResults, bookMeta, '');
      console.log('[manuscript] filtered:', filteredAwards.length);

      // Attach matchReason for UI
      const matched = filteredAwards.map(a => ({
        ...a,
        matchReason: a.notes,
      }));

      const result = { ...bookMeta, matchedAwards: matched };
      return res.json({ content: [{ type: 'text', text: JSON.stringify(result) }] });
    }

    return res.status(400).json({ error: `Unknown type: "${type}"` });

  } catch (e) {
    console.error(`[api/ai] type="${type}" error:`, e.message);
    return res.status(500).json({ error: e.message });
  }
}
