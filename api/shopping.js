const https = require('https');

const OWNER = process.env.GITHUB_OWNER;
const REPO  = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const PATH  = 'data/shopping.json';

const SPICE_KEYWORDS = [
  'salz','pfeffer','paprika','kurkuma','zimt','muskat','oregano','thymian',
  'cayenne','kümmel','lorbeer','wacholder','nelken','piment','koriander',
  'kreuzkümmel','curry','chili','ingwer','knoblauchpulver','zwiebelpulver',
  'hefeflocken','backpulver','natron','vanilleextrakt','vanillezucker',
  'sahnesteif','speisestärke','essig','balsamico','sojasauce','sojasoße',
  'liquid smoke','misopaste','agavendicksaft','ahornsirup','zucker',
  'puderzucker','öl','olivenöl','pflanzenöl','prise','schuss','──',
  'optional','nach geschmack','nach wunsch','zum braten','zum servieren',
  'zum garnieren','zum bestäuben'
];

function isSpice(ingredient) {
  const lower = ingredient.toLowerCase().trim();
  if (lower.startsWith('──') || lower === '') return true;
  return SPICE_KEYWORDS.some(kw => {
    const words = lower.split(/[\s,+&:()/]/);
    return words.some(w => w.length > 2 && (w === kw || w.startsWith(kw)));
  });
}

// Parse a quantity string like "200g", "1 EL", "2–3", "½", "300 ml"
// Returns { amount: number|null, unit: string|null, name: string }
function parseIngredient(text) {
  const t = text.trim();

  // Normalize unicode fractions and ranges
  let normalized = t
    .replace(/½/g, '0.5').replace(/¼/g, '0.25').replace(/¾/g, '0.75')
    .replace(/⅓/g, '0.33').replace(/⅔/g, '0.67')
    .replace(/(\d+)–(\d+)/g, (_, a, b) => String((parseFloat(a) + parseFloat(b)) / 2)); // average of ranges

  // Match: optional number + optional unit + rest
  const m = normalized.match(/^([\d.,]+)?\s*(g|kg|ml|l|el|tl|stk|stück|dose|pkg|pck|bund|scheibe[n]?|zehe[n]?|stange[n]?|handvoll|prise[n]?)\.?\s+(.+)/i);

  if (m) {
    const amount = m[1] ? parseFloat(m[1].replace(',', '.')) : null;
    const unit = m[2] ? m[2].toLowerCase().replace(/[n]$/, '') : null; // normalize plural
    const name = m[3].trim().toLowerCase();
    return { amount, unit, name, original: t };
  }

  // No quantity found – treat whole string as name
  return { amount: null, unit: null, name: normalized.trim().toLowerCase(), original: t };
}

// Merge two items with same name
function mergeAmounts(existing, incoming) {
  if (existing.amount === null || incoming.amount === null) {
    // Can't add – just keep existing, append note
    return existing;
  }
  // Same unit or compatible
  if (existing.unit === incoming.unit) {
    return { ...existing, amount: existing.amount + incoming.amount };
  }
  // kg ↔ g conversion
  if (existing.unit === 'g' && incoming.unit === 'kg') {
    return { ...existing, amount: existing.amount + incoming.amount * 1000 };
  }
  if (existing.unit === 'kg' && incoming.unit === 'g') {
    return { ...existing, amount: existing.amount + incoming.amount / 1000 };
  }
  // l ↔ ml conversion
  if (existing.unit === 'ml' && incoming.unit === 'l') {
    return { ...existing, amount: existing.amount + incoming.amount * 1000 };
  }
  if (existing.unit === 'l' && incoming.unit === 'ml') {
    return { ...existing, amount: existing.amount + incoming.amount / 1000 };
  }
  // Incompatible units – keep as-is
  return existing;
}

// Format amount back to string
function formatAmount(amount, unit) {
  if (amount === null) return '';
  // Round nicely
  let a = Math.round(amount * 100) / 100;
  // Convert back if large
  if (unit === 'g' && a >= 1000) { a = a / 1000; unit = 'kg'; }
  if (unit === 'ml' && a >= 1000) { a = a / 1000; unit = 'l'; }
  const aStr = a % 1 === 0 ? String(a) : String(a).replace('.', ',');
  return unit ? `${aStr} ${unit}` : aStr;
}

// Build display text from parsed item
function buildDisplayText(item) {
  const prefix = formatAmount(item.amount, item.unit);
  // Capitalize name
  const name = item.name.charAt(0).toUpperCase() + item.name.slice(1);
  return prefix ? `${prefix} ${name}` : name;
}

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { items } = await readFile();
      return res.status(200).json(items);
    }

    if (req.method === 'POST') {
      const { zutaten } = req.body;
      const { items, sha } = await readFile();

      const filtered = (zutaten || []).filter(z => !isSpice(z));
      let added = 0;

      filtered.forEach(z => {
        const parsed = parseIngredient(z);
        if (!parsed.name) return;

        // Find existing item with same normalized name
        const existing = items.find(it => it.name === parsed.name);
        if (existing) {
          const merged = mergeAmounts(existing, parsed);
          existing.amount = merged.amount;
          existing.unit = merged.unit;
          existing.text = buildDisplayText(existing);
        } else {
          items.push({
            id: Date.now() + Math.random(),
            name: parsed.name,
            amount: parsed.amount,
            unit: parsed.unit,
            text: buildDisplayText(parsed),
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
