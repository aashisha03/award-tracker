export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

const CLAUDE_URL = 'https://developer.osv.engineering/inference/v1/chat/completions';
const CLAUDE_MODEL = 'anthropic/claude-sonnet-4-5-20250929';
const SEARCH_URL = 'https://developer.osv.engineering/alpha/web/search';
const CRAWL_URL  = 'https://developer.osv.engineering/web/crawl';
const EXTRACT_URL = 'https://developer.osv.engineering/web/extract';

// ââ Shared helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function callClaude(messages, systemPrompt, maxTokens = 1500) {
  const body = {
    model: CLAUDE_MODEL,
max_tokens: maxTokens,
messages: systemPrompt 
  ? [{ role: 'system', content: systemPrompt || 'You are a helpful assistant. Always respond with valid JSON only. No markdown fences, no explanation.' }, ...messages]
  : messages,
  };
  const r = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {   
    'Content-Type': 'application/json',
'Authorization': `Bearer ${process.env.OSV_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '(unreadable)');
    throw new Error(`Claude API ${r.status}: ${t}`);
  }
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content;
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

// ââ Pipeline steps âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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
async function step1b_discoverQueries(query, bookTitle, projectType, projectDescription) {
  const context = projectDescription
    ? `Project: "${bookTitle || 'Untitled'}" (${projectType || 'book'}). Details: ${projectDescription}`
    : `Project: "${bookTitle || 'Untitled'}" (${projectType || 'book'}).`;
  const prompt = `Generate 4-6 targeted web search queries to find literary awards matching this user query: "${query}"
${context}

Return JSON array of search query strings only:
["query1", "query2", "query3", "query4"]

Make queries specific and diverse: include the genre/category from the user query, award type, year (2025 or 2026), and submission status. Do NOT restrict to any single genre â match the user's query.`;

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
  const genres = (bookMeta.genres || []).join(', ') || 'general';
  const prompt = `You are a literary awards expert. Here are web search results that may contain literary award opportunities.

PROJECT CONTEXT:
- Title: ${bookMeta.title || 'Unknown'}
- Genres/Categories: ${genres}
${bookMeta.projectType ? `- Type: ${bookMeta.projectType}` : ''}
${bookMeta.projectDescription ? `- Description: ${bookMeta.projectDescription}` : ''}

ALREADY TRACKING (exclude these): ${existing || 'none'}

SEARCH RESULTS:
${JSON.stringify(searchResults.slice(0, 30), null, 2)}

Select 3-8 results that are REAL literary award opportunities (not listicles, not blogs about awards, not eligibility guides). For each, produce:
[
  {
    "name": "Official Award Name",
    "url": "direct URL to the award/submission page",
    "notes": "2-3 sentences on eligibility and fit",
    "deadline": "deadline if visible in snippet, else 'Check website'",
    "status": "eligible if book clearly qualifies, ineligible if it clearly does not, researching if unsure"
  }
]

Include awards that match the genres/categories above. Be inclusive â if an award plausibly fits, include it with status "researching". Return JSON array only.`;

  const text = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  return safeParseJSON(text);
}

// STEP 4: Crawl each award site and extract submission requirements via Claude
async function step4_extractRequirements(award, bookTitle) {
  const pageText = await getAwardPageText(award.url);

  if (!pageText || pageText.length < 100) {
    // No crawl data â Claude uses its knowledge
    const prompt = `List submission requirements for the literary award "${award.name}" (${award.url}).
Project: "${bookTitle || 'Unknown Title'}".
Include: entry fees, physical/digital submission format, word count limits, eligibility rules, deadline, supporting docs.
JSON array, max 8 items: [{"id":"1","text":"Specific actionable requirement","done":false}]`;
    const text = await callClaude([{ role: 'user', content: prompt }], null, 1000);
    return safeParseJSON(text);
  }

  const prompt = `You have crawled the website for the literary award "${award.name}".

CRAWLED CONTENT:
${pageText}

Extract all submission requirements and process details relevant to submitting "${bookTitle || 'Unknown Title'}".

Include: entry fees, physical copy requirements + mailing address, digital format specs, word count limits, eligibility rules, important deadlines, required supporting documents, judge/jury info if present.

Return JSON array, max 10 items:
[{"id":"1","text":"Specific actionable requirement or step","done":false}]

Return JSON only.`;

  const text = await callClaude([{ role: 'user', content: prompt }], null, 1200);
  return safeParseJSON(text);
}

// ââ Main handler âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.OSV_API_KEY) {
    return res.status(500).json({ error: 'OSV_API_KEY is not set.' });
  }

  const { type, query, existing, awardName, awardUrl, manuscriptText, fileName, projectName, bookTitle, projectType, projectDescription } = req.body;

  try {

    // ââ DISCOVER: User types a description â full pipeline âââââââââââââââââ
    if (type === 'discover') {
      // 1. Generate search queries
      const queries = await step1b_discoverQueries(query, bookTitle, projectType, projectDescription);
      console.log('[discover] queries:', queries);

      // 2. Search the web
      const rawResults = await step2_searchAwards(Array.isArray(queries) ? queries : [query]);
      console.log('[discover] raw results:', rawResults.length);

      // 3. Filter with Claude â pass project context for accurate matching
      const filtered = await step3_filterAwards(rawResults, { title: bookTitle || 'Unknown Title', genres: [query], projectType, projectDescription }, existing);
      console.log('[discover] filtered awards:', filtered.length);

      return res.json({ content: [{ type: 'text', text: JSON.stringify(filtered) }] });
    }

    // ââ ANALYZE: Fetch & extract requirements for a known award ââââââââââââ
    if (type === 'analyze') {
      const reqs = await step4_extractRequirements({ name: awardName, url: awardUrl }, bookTitle);
      return res.json({ content: [{ type: 'text', text: JSON.stringify(reqs) }] });
    }

    // ââ MANUSCRIPT: Full pipeline from uploaded manuscript âââââââââââââââââ
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
