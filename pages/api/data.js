import { createClient } from '@supabase/supabase-js';

// ── Supabase client ─────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set.');
  return createClient(url, key);
}

// ── Mappers (keep same shape the frontend expects) ──────────────────────────
function mapProject(r) {
  return {
    id:          r.id,
    name:        r.name        || '',
    type:        r.type        || 'book',
    description: r.description || '',
  };
}

function mapAward(r) {
  return {
    id:        r.id,
    name:      r.name      || '',
    url:       r.url       || '',
    notes:     r.notes     || '',
    deadline:  r.deadline  || '',
    status:    r.status    || 'researching',
    searchTag: r.searchTag || '',
    projectId: r.projectId || '',
    requirements: [],
    costs: [],
  };
}

function mapReq(r) {
  return {
    id:      r.id,
    awardId: r.awardId || '',
    text:    r.text    || '',
    done:    r.done    || false,
  };
}

function mapCost(r) {
  return {
    id:           r.id,
    awardId:      r.awardId      || '',
    category:     r.category     || '',
    amount:       r.amount       ?? 0,
    description:  r.description  || '',
    driveFileId:  r.driveFileId  || '',
    driveFileUrl: r.driveFileUrl || '',
    fileName:     r.fileName     || '',
  };
}

// ── Helper: throw on Supabase errors ────────────────────────────────────────
function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL) {
    return res.status(500).json({ error: 'SUPABASE_URL is not set in Vercel environment variables.' });
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'SUPABASE_ANON_KEY is not set in Vercel environment variables.' });
  }

  const sb    = getSupabase();
  const { type } = req.query;

  try {

    // ── PROJECTS ──────────────────────────────────────────────────────────
    if (type === 'projects') {
      if (req.method === 'GET') {
        const data = check(await sb.from('projects').select('*').order('created_at'));
        return res.json(data.map(mapProject));
      }

      if (req.method === 'POST') {
        const { name, type: projType, description } = req.body;
        const rows = check(await sb.from('projects').insert({
          name,
          type:        projType || 'book',
          description: description || '',
        }).select());
        return res.status(201).json(mapProject(rows[0]));
      }

      if (req.method === 'PATCH') {
        const { id, name, type: projType, description } = req.body;
        const updates = {};
        if (name        !== undefined) updates.name        = name;
        if (projType    !== undefined) updates.type        = projType;
        if (description !== undefined) updates.description = description;
        const rows = check(await sb.from('projects').update(updates).eq('id', id).select());
        return res.json(mapProject(rows[0]));
      }

      if (req.method === 'DELETE') {
        check(await sb.from('projects').delete().eq('id', req.body.id));
        return res.json({ success: true });
      }
    }

    // ── AWARDS ────────────────────────────────────────────────────────────
    if (type === 'awards') {
      if (req.method === 'GET') {
        const data = check(await sb.from('awards').select('*').order('created_at'));
        return res.json(data.map(mapAward));
      }

      if (req.method === 'POST') {
        const { name, url, notes, deadline, status, searchTag, projectId } = req.body;
        const rows = check(await sb.from('awards').insert({
          name,
          url:       url       || '',
          notes:     notes     || '',
          deadline:  deadline  || '',
          status:    status    || 'researching',
          searchTag: searchTag || '',
          projectId: projectId || null,
        }).select());
        return res.status(201).json(mapAward(rows[0]));
      }

      if (req.method === 'PATCH') {
        const { id, status, name, url, notes, deadline, projectId } = req.body;
        const updates = {};
        if (status    !== undefined) updates.status    = status;
        if (name      !== undefined) updates.name      = name;
        if (url       !== undefined) updates.url       = url;
        if (notes     !== undefined) updates.notes     = notes;
        if (deadline  !== undefined) updates.deadline   = deadline;
        if (projectId !== undefined) updates.projectId = projectId || null;
        const rows = check(await sb.from('awards').update(updates).eq('id', id).select());
        return res.json(mapAward(rows[0]));
      }

      if (req.method === 'DELETE') {
        check(await sb.from('awards').delete().eq('id', req.body.id));
        return res.json({ success: true });
      }
    }

    // ── REQUIREMENTS ──────────────────────────────────────────────────────
    if (type === 'requirements') {
      if (req.method === 'GET') {
        const data = check(await sb.from('requirements').select('*').order('created_at'));
        return res.json(data.map(mapReq));
      }

      if (req.method === 'POST') {
        const { awardId, text, done } = req.body;
        const rows = check(await sb.from('requirements').insert({
          awardId,
          text,
          done: done || false,
        }).select());
        return res.status(201).json(mapReq(rows[0]));
      }

      if (req.method === 'PATCH') {
        const { id, done } = req.body;
        const rows = check(await sb.from('requirements').update({ done }).eq('id', id).select());
        return res.json(mapReq(rows[0]));
      }

      if (req.method === 'DELETE') {
        check(await sb.from('requirements').delete().eq('id', req.body.id));
        return res.json({ success: true });
      }
    }

    // ── COSTS ─────────────────────────────────────────────────────────────
    if (type === 'costs') {
      if (req.method === 'GET') {
        const data = check(await sb.from('costs').select('*').order('created_at'));
        return res.json(data.map(mapCost));
      }

      if (req.method === 'POST') {
        const { awardId, category, amount, description, driveFileId, driveFileUrl, fileName } = req.body;
        const rows = check(await sb.from('costs').insert({
          awardId,
          category:     category     || '',
          amount:       amount       || 0,
          description:  description  || '',
          driveFileId:  driveFileId  || '',
          driveFileUrl: driveFileUrl || '',
          fileName:     fileName     || '',
        }).select());
        return res.status(201).json(mapCost(rows[0]));
      }

      if (req.method === 'DELETE') {
        check(await sb.from('costs').delete().eq('id', req.body.id));
        return res.json({ success: true });
      }
    }

    return res.status(400).json({ error: `Unknown type: "${type}"` });

  } catch (e) {
    console.error(`[api/data] type="${type}" method="${req.method}" error:`, e.message);
    return res.status(500).json({ error: e.message });
  }
}
