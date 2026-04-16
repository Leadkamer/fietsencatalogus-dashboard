const SHEET_ID = '1xFhHJaFB9Xahi-PRSSf-NPkz6UpHCU8EVy96-9de4jM';
const FEED_CACHE_GID = '685829716';
const WINKELS_GID = '466920253';

module.exports = async function handler(req, res) {
  var winkel_id = (req.query.winkel_id || '').trim();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');

  if (!winkel_id) {
    res.status(200).send('<html><body><p>Geen winkel_id opgegeven.</p></body></html>');
    return;
  }

  try {
    var feedUrl = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + FEED_CACHE_GID;
    var winkelsUrl = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + WINKELS_GID;

    var feedResp = await fetch(feedUrl);
    var winkelsResp = await fetch(winkelsUrl);
    var feedCsv = await feedResp.text();
    var winkelsCsv = await winkelsResp.text();

    var feedRows = parseCsv(feedCsv);
    var winkelsRows = parseCsv(winkelsCsv);

    // Find winkel name + logo
    var winkelsHeader = winkelsRows[0].map(function(h) { return h.trim(); });
    var wIdIdx = winkelsHeader.indexOf('winkel_id');
    var wNaamIdx = winkelsHeader.indexOf('winkelnaam');
    var wLogoIdx = winkelsHeader.indexOf('logo_url');
    var winkelnaam = winkel_id;
    var logoUrl = '';
    for (var w = 1; w < winkelsRows.length; w++) {
      if (String(winkelsRows[w][wIdIdx] || '').trim() === winkel_id) {
        winkelnaam = (winkelsRows[w][wNaamIdx] || '').trim() || winkel_id;
        logoUrl = (winkelsRows[w][wLogoIdx] || '').trim();
        break;
      }
    }

    // Find feed data
    var feedHeader = feedRows[0].map(function(h) { return h.trim(); });
    var fIdIdx = feedHeader.indexOf('winkel_id');
    var fJsonIdx = feedHeader.indexOf('feed_json');
    var feedData = null;
    for (var f = 1; f < feedRows.length; f++) {
      if (String(feedRows[f][fIdIdx] || '').trim() === winkel_id) {
        try { feedData = JSON.parse(feedRows[f][fJsonIdx] || '{}'); } catch(e) {}
        break;
      }
    }

    if (!feedData) {
      res.status(200).send('<html><body><p>Geen nieuwsbrief data gevonden voor ' + esc(winkelnaam) + '.</p></body></html>');
      return;
    }

    var maand = feedData.maand || '';
    var artikelen = [];
    for (var i = 1; i <= 3; i++) {
      var a = feedData['artikel_' + i];
      if (a && (a.titel || a.tekst)) {
        artikelen.push(a);
      }
    }

    // Build HTML
    var html = '<!DOCTYPE html>\n<html lang="nl">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Nieuwsbrief Preview - ' + esc(winkelnaam) + '</title>\n<style>\n* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: Arial, Helvetica, sans-serif; background: #d8d8d8; color: #3b3f44; }\n.wrapper { max-width: 600px; margin: 20px auto; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }\n.header { text-align: center; padding: 24px 20px; }\n.header img { height: 50px; border-radius: 4px; }\n.maand { text-align: center; font-size: 12px; color: #858588; padding: 8px 20px 0; }\n.artikel { padding: 24px 20px; }\n.artikel h2 { font-size: 18px; font-weight: 700; color: #3b3f44; margin-bottom: 12px; text-align: center; }\n.artikel img { width: 100%; border-radius: 4px; margin-bottom: 12px; display: block; }\n.artikel p { font-size: 14px; line-height: 1.6; margin-bottom: 16px; }\n.artikel .btn { display: block; width: 266px; margin: 0 auto; padding: 12px 40px; background: #000; color: #fff; text-decoration: none; border-radius: 20px; font-weight: 700; font-size: 16px; text-align: center; }\n.divider { width: 70%; margin: 0 auto; border: none; border-top: 1px solid #4A4A4A; padding: 10px 0; }\n.footer { background: #eff2f7; padding: 24px 20px; text-align: center; }\n.footer h3 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }\n.footer p { font-size: 14px; color: #3b3f44; }\n.badge { display: inline-block; background: #fef2f0; color: #c8524b; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 700; margin: 16px auto; }\n</style>\n</head>\n<body>\n<div class="wrapper">\n';

    html += '<div class="maand">Nieuwsbrief ' + esc(maand) + '</div>\n';
    html += '<div class="header">';
    if (logoUrl) {
      html += '<img src="' + esc(logoUrl) + '" alt="' + esc(winkelnaam) + '">';
    } else {
      html += '<h2 style="color:#c8524b;">' + esc(winkelnaam) + '</h2>';
    }
    html += '</div>\n';
    html += '<div style="text-align:center;"><span class="badge">PREVIEW - Ter goedkeuring</span></div>\n';

    for (var j = 0; j < artikelen.length; j++) {
      if (j > 0) html += '<hr class="divider">\n';
      var art = artikelen[j];
      html += '<div class="artikel">\n';
      html += '<h2>' + esc(art.titel || '') + '</h2>\n';
      if (art.image) {
        html += '<img src="' + esc(art.image) + '" onerror="this.style.display=\'none\'">\n';
      }
      html += '<p>' + escHtml(art.tekst || '') + '</p>\n';
      if (art.url && art.url !== '#' && art.url !== '') {
        html += '<a href="' + esc(art.url) + '" class="btn">Lees verder</a>\n';
      }
      html += '</div>\n';
    }

    html += '<div class="footer">\n';
    html += '<h3>' + esc(winkelnaam) + '</h3>\n';
    html += '<p>Aangeboden door Fietsencatalogus.nl</p>\n';
    html += '</div>\n';
    html += '</div>\n</body>\n</html>';

    res.status(200).send(html);
  } catch (err) {
    res.status(200).send('<html><body><p>Er ging iets mis bij het laden van de preview.</p></body></html>');
  }
};

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escHtml(s) {
  return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function parseCsv(text) {
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {}
      else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
