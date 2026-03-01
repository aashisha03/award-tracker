import Airtable from 'airtable';

// ── Field name maps ────────────────────────────────────────────────────────────
// Airtable field names are CASE-SENSITIVE and must match your table exactly.
// Edit these constants if your Airtable columns are named differently
// (e.g. change 'name' → 'Name' if your Awards table has a "Name" column).
const AW = {
  name:     'name',
  url:      'url',
  notes:    'notes',
  deadline: 'deadline',
  status:   'status',
};
const RQ = {
  awardId: 'awardId',
  text:    'text',
  done:    'done',
};

// ── Mappers ────────────────────────────────────────────────────────────────────
// Previously the GET handler had multi-casing fallbacks (r.fields.name || r.fields.Name)
// but the POST response only read r.fields.name — so if your Airtable column is
// "Name", newly created awards came back with name: undefined and rendered blank.
// Now all reads go through these shared mappers so GET and POST behave identically.

function mapAward(r) {
  const f = r.fields;
  return {
    id:       r.id,
    name:     f[AW.name]     || f.Name     || '',
    url:      f[AW.url]      || f.URL      || f.Url      || '',
    notes:    f[AW.notes]    || f.Notes    || '',
    deadline: f[AW.deadline] || f.Deadline || '',
    status:   f[AW.status]   || f.Status   || 'researching',
    requirements: [],
  };
}

function mapReq(r) {
  const f = r.fields;
  return {
    id:      r.id,
    awardId: f[RQ.awardId] || f.AwardId || '',
    text:    f[RQ.text]    || f.Text    || '',
    // Airtable checkbox fields return undefined (not false) when unchecked
    done:    f[RQ.done]    || false,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Guard missing env vars — previously these produced a cryptic Airtable
  // constructor error deep in the stack; now you get a clear message in Vercel logs.
  if (!process.env.AIRTABLE_API_KEY) {
    return res.status(500).json({ error: 'AIRTABLE_API_KEY is not set in Vercel environment variables.' });
  }
  if (!process.env.AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: 'AIRTABLE_BASE_ID is not set in Vercel environment variables.' });
  }

  const base  = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
  const { type } = req.query;

  try {
    // ── AWARDS ────────────────────────────────────────────────────────────
    if (type === 'awards') {
      const table = base('Awards');

      if (req.method === 'GET') {
        const records = await table.select().all();
        return res.json(records.map(mapAward));
      }

      if (req.method === 'POST') {
        const { name, url, notes, deadline, status } = req.body;
        const record = await table.create({
          [AW.name]:     name,
          [AW.url]:      url      || '',
          [AW.notes]:    notes    || '',
          [AW.deadline]: deadline || '',
          [AW.status]:   status   || 'researching',
        });
        // Use the shared mapper — previously this read record.fields.name directly,
        // which returned undefined if your Airtable column is capitalised ("Name").
        return res.status(201).json(mapAward(record));
      }

      if (req.method === 'PATCH') {
        const { id, status, name, url, notes, deadline } = req.body;
        const updates = {};
        if (status   !== undefined) updates[AW.status]   = status;
        if (name     !== undefined) updates[AW.name]     = name;
        if (url      !== undefined) updates[AW.url]      = url;
        if (notes    !== undefined) updates[AW.notes]    = notes;
        if (deadline !== undefined) updates[AW.deadline] = deadline;
        const record = await table.update(id, updates);
        return res.json(mapAward(record));
      }

      if (req.method === 'DELETE') {
        await table.destroy(req.body.id);
        return res.json({ success: true });
      }
    }

    // ── REQUIREMENTS ──────────────────────────────────────────────────────
    if (type === 'requirements') {
      const table = base('Requirements');

      if (req.method === 'GET') {
        const records = await table.select().all();
        return res.json(records.map(mapReq));
      }

      if (req.method === 'POST') {
        const { awardId, text, done } = req.body;
        const record = await table.create({
          [RQ.awardId]: awardId,
          [RQ.text]:    text,
          [RQ.done]:    done || false,
        });
        return res.status(201).json(mapReq(record));
      }

      if (req.method === 'PATCH') {
        const { id, done } = req.body;
        const record = await table.update(id, { [RQ.done]: done });
        return res.json(mapReq(record));
      }

      if (req.method === 'DELETE') {
        await table.destroy(req.body.id);
        return res.json({ success: true });
      }
    }

    return res.status(400).json({ error: `Unknown type: "${type}"` });

  } catch (e) {
    console.error(`[api/data] type="${type}" method="${req.method}" error:`, e.message);
    // Return the real error message so you can see it in the browser network tab
    return res.status(500).json({ error: e.message });
  }
}
