const SHEET_ID = '1xFhHJaFB9Xahi-PRSSf-NPkz6UpHCU8EVy96-9de4jM';
const FEED_CACHE_GID = '685829716';

// Laatst succesvol gelezen sheet, per (warme) lambda-instantie. Wordt UITSLUITEND
// gebruikt als de live-lezing mislukt, nooit als gewone cache. Zo blijft de feed
// altijd vers (belangrijk op het moment dat Brevo de campagne bindt), maar valt een
// hapering bij Google niet meer om in een lege nieuwsbrief.
let laatsteGoedeCsv = null;
let laatsteGoedeTijd = 0;
const LAATSTE_GOEDE_MAX_MS = 30 * 60 * 1000;

module.exports = async function handler(req, res) {
  const winkel_id = (req.query.winkel_id || '').trim();

  // Een lege feed met status 200 is het gevaarlijkste antwoord dat deze functie kan
  // geven: Brevo bindt hem dan gewoon en de klant krijgt een nieuwsbrief met alleen
  // het maandkopje, de knoppen en kapotte afbeeldingen. Met een 503 gebruikt Brevo
  // zijn eigen retries (maxRetries: 5) en gaat er niets leegs de deur uit.
  const storing = function (reden) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '2');
    res.setHeader('X-Feed-Status', reden);
    res.status(503).json({ error: 'feed_niet_beschikbaar', reden: reden });
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  // Korte edge-cache (30s) zonder stale-while-revalidate: voorkomt dat een net-gevulde feed
  // nog minutenlang als 'leeg' wordt geserveerd op het moment dat Brevo de campagne bindt.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');

  if (!winkel_id) {
    storing('geen_winkel_id');
    return;
  }

  let csv = null;
  let bron = 'vers';
  try {
    csv = await haalSheetCsv();
    laatsteGoedeCsv = csv;
    laatsteGoedeTijd = Date.now();
  } catch (err) {
    // Google onbereikbaar: val terug op de laatste goede versie in plaats van leeg serveren.
    if (laatsteGoedeCsv && (Date.now() - laatsteGoedeTijd) < LAATSTE_GOEDE_MAX_MS) {
      csv = laatsteGoedeCsv;
      bron = 'laatst-goede-versie';
    } else {
      storing('bron_onbereikbaar');
      return;
    }
  }

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    storing('sheet_leeg');
    return;
  }

  const header = rows[0].map(function (h) { return h.trim(); });
  const winkelIdx = header.indexOf('winkel_id');
  const feedJsonIdx = header.indexOf('feed_json');
  const maandIdx = header.indexOf('maand');
  const updatedIdx = header.indexOf('updated_at');

  if (winkelIdx === -1 || feedJsonIdx === -1) {
    storing('kolommen_ontbreken');
    return;
  }

  const FONT = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;';
  const huidigeMaand = new Date().toLocaleString('nl-NL', { month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' }).toLowerCase().trim();

  const matches = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][winkelIdx] || '').trim().toLowerCase() === winkel_id.toLowerCase()) {
      matches.push(rows[i]);
    }
  }

  if (matches.length === 0) {
    storing('winkel_niet_gevonden');
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

  // Geen enkele rij met content: niets leegs serveren, anders gaat er alsnog een
  // nieuwsbrief zonder artikelen naar de klanten van de winkel.
  if (!chosen) {
    storing('geen_content_voor_winkel');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(chosen[feedJsonIdx] || '{}');
  } catch (e) {
    storing('feed_json_onleesbaar');
    return;
  }

  // Het maandlabel volgt de maand waarin de mail daadwerkelijk de deur uit
  // gaat, niet de tab waarin is goedgekeurd. Een nieuwsbrief die op 1
  // september wordt verstuurd toont dus "september 2026", ook als de
  // content nog uit de augustusrij komt. Brevo haalt deze feed op bij het
  // aanmaken en versturen van de campagne, dus dat is het juiste moment.
  parsed.maand = huidigeMaand;
  for (let a = 1; a <= 3; a++) {
    const key = 'artikel_' + a;
    if (parsed[key] && parsed[key].tekst) {
      // Corrigeer typefouten in links (bv. "https:///" met 3 slashes) zodat ze
      // niet als kapotte/dubbele link in de mail belanden.
      parsed[key].tekst = '<span style="' + FONT + '">' + fixSlashes(parsed[key].tekst) + '</span>';
    }
    if (parsed[key] && parsed[key].url) {
      parsed[key].url = fixSlashes(parsed[key].url);
    }
    if (parsed[key] && parsed[key].image) {
      parsed[key].image = imgProxy(parsed[key].image);
    }
  }

  res.setHeader('X-Feed-Status', 'ok');
  res.setHeader('X-Feed-Bron', bron);
  res.status(200).json(parsed);
};

// Haalt de Feed Cache-tab op als CSV. Google's export-endpoint hapert af en toe
// (traag, throttling, of een HTML-foutpagina met status 200). Daarom: meerdere
// pogingen, een harde timeout, en een controle of het antwoord echt de sheet is.
async function haalSheetCsv() {
  const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + FEED_CACHE_GID;
  let laatsteFout = null;

  for (let poging = 1; poging <= 3; poging++) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 6000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) throw new Error('status ' + response.status);
      const csv = await response.text();
      // Google serveert bij problemen soms een HTML-pagina met status 200.
      if (!/(^|[\r\n])\s*winkel_id\s*,/i.test(csv)) throw new Error('antwoord is geen Feed Cache-CSV');
      return csv;
    } catch (e) {
      laatsteFout = e;
      if (poging < 3) await new Promise(function (r) { setTimeout(r, 250 * poging); });
    } finally {
      clearTimeout(timer);
    }
  }
  throw laatsteFout || new Error('Sheet fetch failed');
}

// Corrigeert URL-typefouten: 3+ slashes na het schema (bv. "https:///") -> 2 slashes.
// Zo'n misvormde URL wordt door Outlook/Brevo als kapotte, dubbel weergegeven link getoond.
function fixSlashes(s) {
  return String(s == null ? '' : s).replace(/(https?:)\/{3,}/gi, '$1//');
}

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
