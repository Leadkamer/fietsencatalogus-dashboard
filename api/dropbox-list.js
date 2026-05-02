// Dropbox media-bibliotheek listing
// Vereist Vercel env vars:
//   DROPBOX_REFRESH_TOKEN
//   DROPBOX_APP_KEY
//   DROPBOX_APP_SECRET
//   DROPBOX_FOLDER_PATH  (bijv. "/Fietsencatalogus/Nieuwsbrief media")

const IMG_EXT = /\.(jpe?g|png|webp|gif|heic)$/i;

async function getAccessToken() {
  const resp = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET
    })
  });
  if (!resp.ok) throw new Error('Token refresh failed: ' + resp.status);
  const data = await resp.json();
  return data.access_token;
}

async function listFolder(token, path) {
  const resp = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: path || '',
      recursive: false,
      include_media_info: false,
      include_deleted: false,
      limit: 200
    })
  });
  if (!resp.ok) throw new Error('list_folder failed: ' + resp.status + ' ' + (await resp.text()));
  return resp.json();
}

async function getOrCreateSharedLink(token, path) {
  // Probeer bestaand link te vinden
  const listResp = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, direct_only: true })
  });
  if (listResp.ok) {
    const data = await listResp.json();
    if (data.links && data.links.length > 0) return data.links[0].url;
  }
  // Maak nieuw link
  const createResp = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, settings: { requested_visibility: { '.tag': 'public' } } })
  });
  if (createResp.status === 409) {
    // Already exists — try list again (race condition)
    const retry = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, direct_only: true })
    });
    const d = await retry.json();
    if (d.links && d.links.length > 0) return d.links[0].url;
    throw new Error('Shared link conflict but none found');
  }
  if (!createResp.ok) throw new Error('create_shared_link failed: ' + createResp.status);
  const created = await createResp.json();
  return created.url;
}

function toDirectUrl(sharedUrl) {
  if (!sharedUrl) return '';
  let url = sharedUrl
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
    .replace('&dl=0', '')
    .replace('?dl=0', '')
    .replace('&dl=1', '')
    .replace('?dl=1', '');
  // Zorg dat rlkey een ? heeft, niet &
  if (url.indexOf('?') === -1) {
    const r = url.indexOf('&rlkey=');
    if (r >= 0) url = url.substring(0, r) + '?' + url.substring(r + 1);
  }
  return url;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!process.env.DROPBOX_REFRESH_TOKEN || !process.env.DROPBOX_APP_KEY || !process.env.DROPBOX_APP_SECRET) {
    res.status(500).json({ success: false, error: 'Dropbox env vars ontbreken (DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET)' });
    return;
  }

  try {
    const path = (req.query && req.query.path) || (req.body && req.body.path) || process.env.DROPBOX_FOLDER_PATH || '';
    const token = await getAccessToken();
    const folder = await listFolder(token, path);
    const files = (folder.entries || []).filter(e => e['.tag'] === 'file' && IMG_EXT.test(e.name));

    const results = await Promise.all(files.map(async f => {
      try {
        const sharedUrl = await getOrCreateSharedLink(token, f.path_lower);
        const directUrl = toDirectUrl(sharedUrl);
        return { name: f.name, path: f.path_display, url: directUrl, size: f.size, modified: f.client_modified };
      } catch (e) {
        return { name: f.name, path: f.path_display, url: '', error: e.message };
      }
    }));

    // Sort newest first
    results.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
    res.status(200).json({ success: true, path: path, count: results.length, files: results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};
