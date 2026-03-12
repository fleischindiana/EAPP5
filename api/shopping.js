const https = require('https');

const OWNER = process.env.GITHUB_OWNER;
const REPO  = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const PATH  = 'data/shopping.json';

// ── Gewürz-Filter ────────────────────────────────────────────────────────────
const SPICE_KEYWORDS = [
  'salz','pfeffer','paprikapulver','kurkuma','zimt','muskat','oregano','thymian',
  'cayenne','kümmel','lorbeer','wacholder','nelken','piment','koriander',
  'kreuzkümmel','curry','chilipulver','ingwerpulver','knoblauchpulver',
  'zwiebelpulver','hefeflocken','backpulver','natron','vanilleextrakt',
  'vanillepaste','vanillezucker','sahnesteif','speisestärke','balsamicoessig',
  'apfelessig','sojasauce','sojasoße','liquid smoke','misopaste','agavendicksaft',
  'ahornsirup','puderzucker','pflanzenöl','olivenöl','kokosöl','sesamöl',
  'prise','schuss','──','optional','nach geschmack','nach wunsch',
  'zum braten','zum servieren','zum garnieren','zum bestäuben','zum bestreichen'
];

function isSpice(name) {
  const lower = name.toLowerCase().trim();
  if (lower.startsWith('──') || lower === '') return true;
  return SPICE_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw));
}

// ── Kategorie-Mapping ─────────────────────────────────────────────────────────
// Reihenfolge: 1=Obst&Gemüse, 2=Gewürze, 3=Gebäck, 4=Kühlwaren,
//              5=Pflanzliche Milch, 6=Konserven, 7=Getreide, 8=Tiefkühl, 9=Getränke, 99=Sonstiges
const CATEGORY_MAP = [
  { cat: 1, label: 'Obst & Gemüse', keywords: [
    'apfel','birne','banane','orange','zitrone','limette','mango','beere','erdbeere',
    'himbeere','blaubeere','johannisbeere','cranberry','pflaume','zwetschge','kirsche',
    'traube','melone','ananas','kiwi','papaya','avocado','tomate','cherrytomaten',
    'paprika','zucchini','gurke','salat','spinat','grünkohl','rosenkohl','brokkoli',
    'blumenkohl','karotte','möhre','sellerie','lauch','zwiebel','knoblauch',
    'süßkartoffel','kartoffel','rübe','radieschen','fenchel','artischocke','spargel',
    'erbsen','bohnen','champignon','pilze','shiitake','ingwer','petersilienwurzel'
  ]},
  { cat: 2, label: 'Gewürze & Würzmittel', keywords: [
    'gewürz','kräuter','basilikum','minze','rosmarin','salbei','dill','schnittlauch',
    'petersilie','korianderkraut'
  ]},
  { cat: 3, label: 'Gebäck & Brot', keywords: [
    'brot','brötchen','toast','weißbrot','vollkornbrot','baguette','ciabatta',
    'dinkelbrötchen','reiswaffel','knäckebrot','cracker'
  ]},
  { cat: 4, label: 'Kühlwaren', keywords: [
    'tofu','tempeh','seitan','veganer joghurt','joghurt','vegane butter','margarine',
    'veganer quark','quark','veganer parmesan','vegane sahne','sahne','kokoscreme',
    'veganer aufschnitt','räuchertofu'
  ]},
  { cat: 5, label: 'Pflanzliche Milch', keywords: [
    'hafermilch','sojamilch','mandelmilch','reismilch','kokosmilch','cashewmilch',
    'erbsenmilch','dinkelmilch','pflanzliche milch'
  ]},
  { cat: 6, label: 'Konserven & Gläser', keywords: [
    'kichererbsen','linsen','rote linsen','weiße bohnen','kidneybohnen','schwarze bohnen',
    'maiskörner','erbsen dose','tomaten dose','gehackte tomaten','tomaten passiert',
    'kokosmilch dose','fruchtmus','preiselbeeren','johannisbeergelee','tahini',
    'getrocknete tomaten','sonnengetrocknete'
  ]},
  { cat: 7, label: 'Getreidesortiment', keywords: [
    'mehl','weizenmehl','dinkelmehl','hafermehl','vollkornmehl','roggenmehl','semola',
    'haferflocken','granola','müsli','nudeln','spaghetti','linsennudeln','reisnudeln',
    'penne','rigatoni','reis','basmatireis','jasminreis','quinoa','hirse','buchweizen',
    'dinkel','gerste','grieß','polenta','couscous','cashewkerne','cashews','mandeln',
    'walnüsse','haselnüsse','erdnüsse','sonnenblumenkerne','kürbiskerne','hanfsamen',
    'chiasamen','leinsamen','sesam','mandelmus','erdnussmus','tahin','proteinpulver',
    'kreatin','schokolade','kakaopulver','drops'
  ]},
  { cat: 8, label: 'Tiefkühlware', keywords: [
    'tiefkühl','gefrorene','blattspinat tk','tk erbsen','tk beeren'
  ]},
  { cat: 9, label: 'Getränke', keywords: [
    'wasser','mineralwasser','saft','orangensaft','apfelsaft','rotwein','weißwein',
    'dunkelbier','malzbier','bier','gemüsebrühe','brühe'
  ]},
];

function getCategory(name) {
  const lower = name.toLowerCase();
  for (const { cat, keywords } of CATEGORY_MAP) {
    if (keywords.some(kw => lower.includes(kw))) return cat;
  }
  return 99; // Sonstiges
}

// ── Ingredient Parser ─────────────────────────────────────────────────────────
function cleanName(raw) {
  return raw
    .replace(/\(.*?\)/g, '')      // alles in Klammern entfernen
    .replace(/\[.*?\]/g, '')      // alles in eckigen Klammern
    .replace(/mind\..+/gi, '')    // "mind. X Std. eingeweicht" etc.
    .replace(/ca\.\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseIngredient(text) {
  const t = text.trim();

  // Normalize unicode fractions and ranges
  let norm = t
    .replace(/½/g, '0.5').replace(/¼/g, '0.25').replace(/¾/g, '0.75')
    .replace(/⅓/g, '0.33').replace(/⅔/g, '0.67')
    .replace(/(\d+)[–-](\d+)/g, (_, a, b) => String((parseFloat(a)+parseFloat(b))/2));

  const m = norm.match(/^([\d.,]+)?\s*(g|kg|ml|l|el|tl|stk|stück|dose[n]?|pkg|pck|bund|scheibe[n]?|zehe[n]?|stange[n]?|handvoll)\.?\s+(.+)/i);

  if (m) {
    const amount = m[1] ? parseFloat(m[1].replace(',', '.')) : null;
    const unit = m[2] ? m[2].toLowerCase().replace(/[ne]$/, '') : null;
    const rawName = m[3];
    const name = cleanName(rawName).toLowerCase();
    return { amount, unit, name, display: buildDisplay(amount, unit, name) };
  }

  const name = cleanName(norm).toLowerCase();
  return { amount: null, unit: null, name, display: buildDisplay(null, null, name) };
}

function buildDisplay(amount, unit, name) {
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  if (!amount) return cap;
  let a = Math.round(amount * 100) / 100;
  let u = unit || '';
  if (u === 'g' && a >= 1000) { a = a/1000; u = 'kg'; }
  if (u === 'ml' && a >= 1000) { a = a/1000; u = 'l'; }
  const aStr = Number.isInteger(a) ? String(a) : String(a).replace('.', ',');
  return `${aStr}${u ? ' '+u : ''} ${cap}`;
}

function mergeAmounts(ex, inc) {
  if (ex.amount === null || inc.amount === null) return ex;
  if (ex.unit === inc.unit) return { ...ex, amount: ex.amount + inc.amount, display: buildDisplay(ex.amount + inc.amount, ex.unit, ex.name) };
  if (ex.unit === 'g' && inc.unit === 'kg') { const a = ex.amount + inc.amount*1000; return { ...ex, amount: a, display: buildDisplay(a, 'g', ex.name) }; }
  if (ex.unit === 'kg' && inc.unit === 'g') { const a = ex.amount + inc.amount/1000; return { ...ex, amount: a, display: buildDisplay(a, 'kg', ex.name) }; }
  if (ex.unit === 'ml' && inc.unit === 'l') { const a = ex.amount + inc.amount*1000; return { ...ex, amount: a, display: buildDisplay(a, 'ml', ex.name) }; }
  if (ex.unit === 'l' && inc.unit === 'ml') { const a = ex.amount + inc.amount/1000; return { ...ex, amount: a, display: buildDisplay(a, 'l', ex.name) }; }
  return ex;
}

// ── GitHub I/O ────────────────────────────────────────────────────────────────
function ghRequest(method, body, sha) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify({
      message: 'update shopping list',
      content: Buffer.from(JSON.stringify(body, null, 2)).toString('base64'),
      ...(sha ? { sha } : {})
    }) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/contents/${PATH}`,
      method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'User-Agent': 'nutrition-app',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function readFile() {
  const r = await ghRequest('GET');
  if (r.status === 404) return { items: [], sha: null };
  const content = JSON.parse(Buffer.from(r.body.content, 'base64').toString());
  return { items: content, sha: r.body.sha };
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { items } = await readFile();
      // Sort by category then alphabetically
      items.sort((a, b) => (a.cat||99) - (b.cat||99) || a.name.localeCompare(b.name, 'de'));
      return res.status(200).json(items);
    }

    if (req.method === 'POST') {
      const { zutaten } = req.body;
      const { items, sha } = await readFile();
      let added = 0;

      (zutaten || []).forEach(z => {
        const parsed = parseIngredient(z);
        if (!parsed.name || isSpice(parsed.name)) return;

        const existing = items.find(it => it.name === parsed.name);
        if (existing) {
          const merged = mergeAmounts(existing, parsed);
          existing.amount = merged.amount;
          existing.unit = merged.unit;
          existing.display = merged.display;
        } else {
          items.push({
            id: Date.now() + Math.random(),
            name: parsed.name,
            amount: parsed.amount,
            unit: parsed.unit,
            display: parsed.display,
            cat: getCategory(parsed.name),
            checked: false
          });
          added++;
        }
      });

      await ghRequest('PUT', items, sha);
      return res.status(200).json({ ok: true, added });
    }

    if (req.method === 'DELETE') {
      const { clearAll } = req.body || {};
      const { items, sha } = await readFile();
      const remaining = clearAll ? [] : items.filter(it => !it.checked);
      await ghRequest('PUT', remaining, sha);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const { id, checked } = req.body;
      const { items, sha } = await readFile();
      const item = items.find(it => String(it.id) === String(id));
      if (item) item.checked = checked;
      await ghRequest('PUT', items, sha);
      return res.status(200).json({ ok: true });
    }

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
