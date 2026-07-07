const SHEET_ID = '1xFhHJaFB9Xahi-PRSSf-NPkz6UpHCU8EVy96-9de4jM';
const FEED_CACHE_GID = '685829716';

module.exports = async function handler(req, res) {
  const winkel_id = (req.query.winkel_id || '').trim();

  const emptyResponse = function () {
    const maand = new Date().toLocaleString('nl-NL', { month: 'long', year: 'numeric' });
    return {
      maand: maand,
      artikel_1: { titel: '', tekst: '', url: '', image: '' },
      artikel_2: { titel: '', tekst: '', url: '', image: '' },
      artikel_3: { titel: '', tekst: '', url: '', image: '' }
    };
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (!winkel_id) {
    res.status(200).json(emptyResponse());
    return;
  }

  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + FEED_CACHE_GID;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Sheet fetch failed');
    const csv = await response.text();

    const rows = parseCsv(csv);
    if (rows.length < 2) {
      res.status(200).json(emptyResponse());
      return;
    }

    const header = rows[0].map(function (h) { return h.trim(); });
    const winkelIdx = header.indexOf('winkel_id');
    const feedJsonIdx = header.indexOf('feed_json');
    const maandIdx = header.indexOf('maand');
    const updatedIdx = header.indexOf('updated_at');

    if (winkelIdx === -1 || feedJsonIdx === -1) {
      res.status(200).json(emptyResponse());
      return;
    }

    const FONT = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;';
    const huidigeMaand = new Date().toLocaleString('nl-NL', { month: 'long', year: 'numeric' }).toLowerCase().trim();

    const matches = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][winkelIdx] || '').trim().toLowerCase() === winkel_id.toLowerCase()) {
        matches.push(rows[i]);
      }
    }

    if (matches.length === 0) {
      res.status(200).json(emptyResponse());
      return;
    }

    // Bepaal of een rij daadwerkelijk content heeft (minstens 1 artikel met titel)
    const rowHasContent = function (r) {
      try {
        const p = JSON.parse((feedJsonIdx !== -1 ? r[feedJsonIdx] : '') || '{}');
        for (let a = 1; a <= 3; a++) {
          const art = p['artikel_' + a];
          if (art && String(art.titel || '').trim()) return true;
        }
        return false;
      } catch (e) { return false; }
    };

    // Rijen op nieuwste updated_at eerst
    const byNewest = matches.slice().sort(function (a, b) {
      return String((updatedIdx !== -1 ? b[updatedIdx] : '') || '').localeCompare(String((updatedIdx !== -1 ? a[updatedIdx] : '') || ''));
    });

    let chosen = null;
    // 1. Huidige maand, mits die rij content heeft
    if (maandIdx !== -1) {
      chosen = byNewest.find(function (r) {
        return String(r[maandIdx] || '').toLowerCase().trim() === huidigeMaand && rowHasContent(r);
      });
    }
    // 2. Anders de nieuwste rij MET content (zo blokkeert een lege huidige-maand-rij nooit echte content)
    if (!chosen) chosen = byNewest.find(rowHasContent);
    // 3. Anders huidige maand zonder content
    if (!chosen && maandIdx !== -1) {
      chosen = byNewest.find(function (r) {
        return String(r[maandIdx] || '').toLowerCase().trim() === huidigeMaand;
      });
    }
    // 4. Anders gewoon de nieuwste rij
    if (!chosen) chosen = byNewest[0] || matches[matches.length - 1];

    try {
      const parsed = JSON.parse(chosen[feedJsonIdx] || '{}');
      for (let a = 1; a <= 3; a++) {
        const key = 'artikel_' + a;
        if (parsed[key] && parsed[key].tekst) {
          parsed[key].tekst = '<span style="' + FONT + '">' + parsed[key].tekst + '</span>';
        }
        if (parsed[key] && parsed[key].image) {
          parsed[key].image = imgProxy(parsed[key].image);
        }
      }
      res.status(200).json(parsed);
      return;
    } catch (e) {
      res.status(200).json(emptyResponse());
      return;
    }
  } catch (err) {
    res.status(200).json(emptyResponse());
  }
};

// Normaliseert afbeeldingen voor mailclients (incl. Outlook desktop):
// - WebP wordt omgezet naar JPEG
// - Dropbox/Drive-redirect-hotlinks worden via images.weserv.nl als echte JPEG geserveerd
// Normale JPG/PNG op echte hosts blijven ongewijzigd (die werken al overal).
function imgProxy(url) {
  if (!url) return url;
  var u = String(url).trim();
  if (!u || u === '#') return url;
  var low = u.toLowerCase();
  var needs = low.indexOf('dropbox.com') !== -1 || low.indexOf('drive.google.com') !== -1 || low.indexOf('.webp') !== -1;
  if (!needs) return url;
  // Dropbox share-link -> directe downloadhost + dl=1 (anders 404 voor externe fetchers)
  u = u.replace('://www.dropbox.com', '://dl.dropboxusercontent.com').replace('://dropbox.com', '://dl.dropboxusercontent.com');
  if (u.toLowerCase().indexOf('dropboxusercontent.com') !== -1) {
    u = u.replace(/([?&])raw=1\b/i, '$1dl=1');
    if (!/[?&]dl=1\b/i.test(u)) { u += (u.indexOf('?') !== -1 ? '&' : '?') + 'dl=1'; }
  }
  var clean = u.replace(/^https?:\/\//, '');
  return 'https://images.weserv.nl/?url=' + encodeURIComponent(clean) + '&output=jpg&w=1400&we&q=82';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c === '\r') {
        // skip
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
