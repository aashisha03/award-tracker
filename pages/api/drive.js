import { google } from 'googleapis';
import { Readable } from 'stream';

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

// ── Auth ────────────────────────────────────────────────────────────────────────
function getDriveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Google service account credentials not configured.');

  const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/drive.file']);
  return google.drive({ version: 'v3', auth });
}

// Cache for sub-folder IDs: { projectName: folderId }
const folderCache = {};

async function getOrCreateProjectFolder(drive, projectName) {
  const parentId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!parentId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set.');

  if (folderCache[projectName]) return folderCache[projectName];

  // Check if folder already exists
  const query = `'${parentId}' in parents and name='${projectName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await drive.files.list({ q: query, fields: 'files(id,name)', spaces: 'drive' });

  if (list.data.files.length > 0) {
    folderCache[projectName] = list.data.files[0].id;
    return list.data.files[0].id;
  }

  // Create sub-folder
  const folder = await drive.files.create({
    requestBody: {
      name: projectName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });

  folderCache[projectName] = folder.data.id;
  return folder.data.id;
}

// ── Handler ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  try {
    const drive = getDriveClient();

    // ── UPLOAD ──────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { fileName, fileData, mimeType, projectName } = req.body;
      // fileData is base64-encoded file content from the frontend
      if (!fileData || !fileName) {
        return res.status(400).json({ error: 'fileName and fileData (base64) are required.' });
      }

      const folderId = await getOrCreateProjectFolder(drive, projectName || 'General');
      const buffer = Buffer.from(fileData, 'base64');

      const file = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [folderId],
        },
        media: {
          mimeType: mimeType || 'application/octet-stream',
          body: Readable.from(buffer),
        },
        fields: 'id,webViewLink',
      });

      return res.status(201).json({
        fileId:  file.data.id,
        fileUrl: file.data.webViewLink,
        fileName,
      });
    }

    // ── DELETE ──────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { fileId } = req.body;
      if (!fileId) return res.status(400).json({ error: 'fileId is required.' });

      await drive.files.delete({ fileId });
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error('[api/drive] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
