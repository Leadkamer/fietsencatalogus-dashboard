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

    const FONT = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3b3f44;line-height:1.5;';
    const huidigeMaand = new Date().toLocaleString('nl-NL', { month: 'long', year: 'numeric' }).toLowerCase().trim();

    const matches = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][winkelIdx] || '').trim() === winkel_id) {
        matches.push(rows[i]);
      }
    }

    if (matches.length === 0) {
      res.status(200).json(emptyResponse());
      return;
    }

    let chosen = null;
    if (maandIdx !== -1) {
      chosen = matches.find(function (r) {
        return String(r[maandIdx] || '').toLowerCase().trim() === huidigeMaand;
      });
    }
    if (!chosen && updatedIdx !== -1) {
      chosen = matches.slice().sort(function (a, b) {
        return String(b[updatedIdx] || '').localeCompare(String(a[updatedIdx] || ''));
      })[0];
    }
    if (!chosen) chosen = matches[matches.length - 1];

    try {
      const parsed = JSON.parse(chosen[feedJsonIdx] || '{}');
      for (let a = 1; a <= 3; a++) {
        const key = 'artikel_' + a;
        if (parsed[key] && parsed[key].tekst) {
          parsed[key].tekst = '<span style="' + FONT + '">' + parsed[key].tekst + '</span>';
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
