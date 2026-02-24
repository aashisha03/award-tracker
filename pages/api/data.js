import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

export default async function handler(req, res) {
  const { type, awardId } = req.query;

  try {
    // ── AWARDS ──────────────────────────────────────────
    if (type === 'awards') {
      const table = base('Awards');

      if (req.method === 'GET') {
        const records = await table.select().all();
        return res.json(records.map(r => ({
          id: r.id,
  name: r.fields.name || r.fields.Name || '',
  url: r.fields.url || r.fields.URL || r.fields.Url || '',
  notes: r.fields.notes || r.fields.Notes || '',
  deadline: r.fields.deadline || r.fields.Deadline || '',
  status: r.fields.status || r.fields.Status || 'researching',
  requirements: []
        })));
      }

      if (req.method === 'POST') {
        const { name, url, notes, deadline, status } = req.body;
        const record = await table.create({ name, url: url||'', notes: notes||'', deadline: deadline||'', status: status||'researching' });
        return res.json({ id: record.id, name: record.fields.name, url: record.fields.url||'', notes: record.fields.notes||'', deadline: record.fields.deadline||'', status: record.fields.status||'researching', requirements: [] });
      }

      if (req.method === 'PATCH') {
        const { id, status } = req.body;
        const record = await table.update(id, { status });
        return res.json({ id: record.id, status: record.fields.status });
      }

      if (req.method === 'DELETE') {
        await table.destroy(req.body.id);
        return res.json({ success: true });
      }
    }

    // ── REQUIREMENTS ────────────────────────────────────
    if (type === 'requirements') {
      const table = base('Requirements');

      if (req.method === 'GET') {
        const params = awardId ? { filterByFormula: `{awardId} = '${awardId}'` } : {};
        const records = await table.select(params).all();
        return res.json(records.map(r => ({
          id: r.id,
          awardId: r.fields.awardId || '',
          text: r.fields.text || '',
          done: r.fields.done || false
        })));
      }

      if (req.method === 'POST') {
        const { awardId, text, done } = req.body;
        const record = await table.create({ awardId, text, done: done || false });
        return res.json({ id: record.id, awardId: record.fields.awardId, text: record.fields.text, done: record.fields.done || false });
      }

      if (req.method === 'PATCH') {
        const { id, done } = req.body;
        const record = await table.update(id, { done });
        return res.json({ id: record.id, done: record.fields.done });
      }

      if (req.method === 'DELETE') {
        await table.destroy(req.body.id);
        return res.json({ success: true });
      }
    }

    res.status(400).json({ error: 'Invalid type' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
