const https = require('https');

const OWNER = process.env.GITHUB_OWNER;
const REPO  = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const PATH  = 'data/shopping.json';

// Gewürz-Filter: diese Begriffe werden herausgefiltert
const SPICE_KEYWORDS = [
  'salz','pfeffer','paprika','kurkuma','zimt','muskat','oregano','thymian',
  'cayenne','kümmel','lorbeer','wacholder','nelken','piment','koriander',
  'kreuzkümmel','curry','chili','ingwer','knoblauchpulver','zwiebelpulver',
  'hefeflocken','backpulver','natron','vanilleextrakt','vanillezucker',
  'sahnesteif','speisestärke','essig','balsamico','sojasauce','sojasoße',
  'liquid smoke','misopaste','agavendicksaft','ahornsirup','zucker',
  'puderzucker','öl','olivenöl','pflanzenöl','prise','schuss','──'
];

function isSpice(ingredient) {
  const lower = ingredient.toLowerCase();
  // Filter Trennzeilen (──) und reine Gewürze
  if (lower.includes('──')) return true;
  return SPICE_KEYWORDS.some(kw => {
    // Nur wenn das Keyword das dominante Element ist (nicht z.B. "Zitronensaft")
    const words = lower.split(/[\s,+&]/);
    return words.some(w => w.startsWith(kw) || kw.startsWith(w) && w.length > 3);
  });
}

function ghRequest(method, body, sha) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify({
      message: `update shopping list`,
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET – return list
    if (req.method === 'GET') {
      const { items } = await readFile();
      return res.status(200).json(items);
    }

    // POST – add ingredients from a recipe
    if (req.method === 'POST') {
      const { recipeName, zutaten } = req.body;
      const { items, sha } = await readFile();

      // Filter spices, then add new items (avoid exact duplicates)
      const filtered = (zutaten || []).filter(z => !isSpice(z));
      filtered.forEach(z => {
        const clean = z.replace(/^──.*──$/, '').trim();
        if (clean && !items.find(it => it.text === clean && it.recipe === recipeName)) {
          items.push({ text: clean, recipe: recipeName, checked: false, id: Date.now() + Math.random() });
        }
      });

      await ghRequest('PUT', items, sha);
      return res.status(200).json({ ok: true, added: filtered.length });
    }

    // DELETE – clear checked items OR clear all
    if (req.method === 'DELETE') {
      const { clearAll } = req.body || {};
      const { items, sha } = await readFile();
      const remaining = clearAll ? [] : items.filter(it => !it.checked);
      await ghRequest('PUT', remaining, sha);
      return res.status(200).json({ ok: true });
    }

    // PATCH – toggle checked state of one item
    if (req.method === 'PATCH') {
      const { id, checked } = req.body;
      const { items, sha } = await readFile();
      const item = items.find(it => it.id === id);
      if (item) item.checked = checked;
      await ghRequest('PUT', items, sha);
      return res.status(200).json({ ok: true });
    }

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
