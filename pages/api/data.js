import Airtable from 'airtable';

// ── Field name maps ────────────────────────────────────────────────────────────
const AW = {
  name:      'name',
  url:       'url',
  notes:     'notes',
  deadline:  'deadline',
  status:    'status',
  searchTag: 'searchTag',
  projectId: 'projectId',
};
const RQ = {
  awardId: 'awardId',
  text:    'text',
  done:    'done',
};
const PJ = {
  name:        'name',
  type:        'type',
  description: 'description',
};
const CT = {
  awardId:      'awardId',
  category:     'category',
  amount:       'amount',
  description:  'description',
  driveFileId:  'driveFileId',
  driveFileUrl: 'driveFileUrl',
  fileName:     'fileName',
};

// ── Mappers ────────────────────────────────────────────────────────────────────
function mapAward(r) {
  const f = r.fields;
  return {
    id:        r.id,
    name:      f[AW.name]      || f.Name      || '',
    url:       f[AW.url]       || f.URL       || f.Url       || '',
    notes:     f[AW.notes]     || f.Notes     || '',
    deadline:  f[AW.deadline]  || f.Deadline  || '',
    status:    f[AW.status]    || f.Status    || 'researching',
    searchTag: f[AW.searchTag] || f.SearchTag || '',
    projectId: f[AW.projectId] || f.ProjectId || '',
    requirements: [],
    costs: [],
  };
}

function mapReq(r) {
  const f = r.fields;
  return {
    id:      r.id,
    awardId: f[RQ.awardId] || f.AwardId || '',
    text:    f[RQ.text]    || f.Text    || '',
    done:    f[RQ.done]    || false,
  };
}

function mapProject(r) {
  const f = r.fields;
  return {
    id:          r.id,
    name:        f[PJ.name]        || f.Name        || '',
    type:        f[PJ.type]        || f.Type        || 'book',
    description: f[PJ.description] || f.Description || '',
  };
}

function mapCost(r) {
  const f = r.fields;
  return {
    id:           r.id,
    awardId:      f[CT.awardId]      || f.AwardId      || '',
    category:     f[CT.category]     || f.Category     || '',
    amount:       f[CT.amount]       ?? f.Amount       ?? 0,
    description:  f[CT.description]  || f.Description  || '',
    driveFileId:  f[CT.driveFileId]  || f.DriveFileId  || '',
    driveFileUrl: f[CT.driveFileUrl] || f.DriveFileUrl || '',
    fileName:     f[CT.fileName]     || f.FileName     || '',
  };
}

// ── Auto-setup: create missing tables via Airtable Metadata API ────────────────
let setupDone = false;

async function ensureTablesExist(apiKey, baseId) {
  if (setupDone) return;

  const metaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  // Fetch existing tables
  const res = await fetch(metaUrl, { headers });
  if (!res.ok) {
    // If metadata API isn't available (e.g. legacy key), skip auto-setup
    console.warn('[auto-setup] Cannot access Metadata API — tables must be created manually.');
    setupDone = true;
    return;
  }
  const { tables } = await res.json();
  const tableNames = tables.map(t => t.name);

  // Create Projects table if missing
  if (!tableNames.includes('Projects')) {
    console.log('[auto-setup] Creating "Projects" table…');
    await fetch(metaUrl, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: 'Projects',
        fields: [
          { name: 'name',        type: 'singleLineText' },
          { name: 'type',        type: 'singleLineText' },
          { name: 'description', type: 'multilineText'   },
        ],
      }),
    });
  }

  // Create Costs table if missing
  if (!tableNames.includes('Costs')) {
    console.log('[auto-setup] Creating "Costs" table…');
    await fetch(metaUrl, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: 'Costs',
        fields: [
          { name: 'awardId',      type: 'singleLineText' },
          { name: 'category',     type: 'singleLineText' },
          { name: 'amount',       type: 'number', options: { precision: 2 } },
          { name: 'description',  type: 'singleLineText' },
          { name: 'driveFileId',  type: 'singleLineText' },
          { name: 'driveFileUrl', type: 'url'             },
          { name: 'fileName',     type: 'singleLineText' },
        ],
      }),
    });
  }

  // Add projectId field to Awards table if missing
  const awardsTable = tables.find(t => t.name === 'Awards');
  if (awardsTable) {
    const fieldNames = awardsTable.fields.map(f => f.name);
    if (!fieldNames.includes('projectId')) {
      console.log('[auto-setup] Adding "projectId" field to Awards table…');
      const fieldsUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${awardsTable.id}/fields`;
      await fetch(fieldsUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'projectId', type: 'singleLineText' }),
      });
    }
  }

  setupDone = true;
  console.log('[auto-setup] Done.');
}

// ── Handler ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (!process.env.AIRTABLE_API_KEY) {
    return res.status(500).json({ error: 'AIRTABLE_API_KEY is not set in Vercel environment variables.' });
  }
  if (!process.env.AIRTABLE_BASE_ID) {
    return res.status(500).json({ error: 'AIRTABLE_BASE_ID is not set in Vercel environment variables.' });
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;

  // Run auto-setup on first request
  try { await ensureTablesExist(apiKey, baseId); } catch (e) {
    console.warn('[auto-setup] Error (non-fatal):', e.message);
  }

  const base  = new Airtable({ apiKey }).base(baseId);
  const { type } = req.query;

  try {

    // ── PROJECTS ──────────────────────────────────────────────────────────
    if (type === 'projects') {
      const table = base('Projects');

      if (req.method === 'GET') {
        const records = await table.select().all();
        return res.json(records.map(mapProject));
      }

      if (req.method === 'POST') {
        const { name, type: projType, description } = req.body;
        const record = await table.create({
          [PJ.name]:        name,
          [PJ.type]:        projType || 'book',
          [PJ.description]: description || '',
        });
        return res.status(201).json(mapProject(record));
      }

      if (req.method === 'PATCH') {
        const { id, name, type: projType, description } = req.body;
        const updates = {};
        if (name        !== undefined) updates[PJ.name]        = name;
        if (projType    !== undefined) updates[PJ.type]        = projType;
        if (description !== undefined) updates[PJ.description] = description;
        const record = await table.update(id, updates);
        return res.json(mapProject(record));
      }

      if (req.method === 'DELETE') {
        await table.destroy(req.body.id);
        return res.json({ success: true });
      }
    }

    // ── AWARDS ────────────────────────────────────────────────────────────
    if (type === 'awards') {
      const table = base('Awards');

      if (req.method === 'GET') {
        const records = await table.select().all();
        return res.json(records.map(mapAward));
      }

      if (req.method === 'POST') {
        const { name, url, notes, deadline, status, searchTag, projectId } = req.body;
        const record = await table.create({
          [AW.name]:      name,
          [AW.url]:       url       || '',
          [AW.notes]:     notes     || '',
          [AW.deadline]:  deadline  || '',
          [AW.status]:    status    || 'researching',
          [AW.searchTag]: searchTag || '',
          [AW.projectId]: projectId || '',
        });
        return res.status(201).json(mapAward(record));
      }

      if (req.method === 'PATCH') {
        const { id, status, name, url, notes, deadline, projectId } = req.body;
        const updates = {};
        if (status    !== undefined) updates[AW.status]    = status;
        if (name      !== undefined) updates[AW.name]      = name;
        if (url       !== undefined) updates[AW.url]       = url;
        if (notes     !== undefined) updates[AW.notes]     = notes;
        if (deadline  !== undefined) updates[AW.deadline]  = deadline;
        if (projectId !== undefined) updates[AW.projectId] = projectId;
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

    // ── COSTS ─────────────────────────────────────────────────────────────
    if (type === 'costs') {
      const table = base('Costs');

      if (req.method === 'GET') {
        const records = await table.select().all();
        return res.json(records.map(mapCost));
      }

      if (req.method === 'POST') {
        const { awardId, category, amount, description, driveFileId, driveFileUrl, fileName } = req.body;
        const record = await table.create({
          [CT.awardId]:      awardId,
          [CT.category]:     category     || '',
          [CT.amount]:       amount       || 0,
          [CT.description]:  description  || '',
          [CT.driveFileId]:  driveFileId  || '',
          [CT.driveFileUrl]: driveFileUrl || '',
          [CT.fileName]:     fileName     || '',
        });
        return res.status(201).json(mapCost(record));
      }

      if (req.method === 'DELETE') {
        await table.destroy(req.body.id);
        return res.json({ success: true });
      }
    }

    return res.status(400).json({ error: `Unknown type: "${type}"` });

  } catch (e) {
    console.error(`[api/data] type="${type}" method="${req.method}" error:`, e.message);
    return res.status(500).json({ error: e.message });
  }
}
