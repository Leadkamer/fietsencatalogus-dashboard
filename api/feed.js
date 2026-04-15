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

    if (winkelIdx === -1 || feedJsonIdx === -1) {
      res.status(200).json(emptyResponse());
      return;
    }

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][winkelIdx] || '').trim() === winkel_id) {
        try {
          const parsed = JSON.parse(rows[i][feedJsonIdx] || '{}');
          res.status(200).json(parsed);
          return;
        } catch (e) {
          res.status(200).json(emptyResponse());
          return;
        }
      }
    }

    res.status(200).json(emptyResponse());
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
