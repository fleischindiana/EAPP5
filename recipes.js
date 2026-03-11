const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const FILE_PATH = 'data/recipes.json';

const ghHeaders = {
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

async function getFile() {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`, { headers: ghHeaders });
  if (res.status === 404) return { data: [], sha: null };
  if (!res.ok) throw new Error(`GitHub GET fehler: ${res.status}`);
  const json = await res.json();
  const data = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
  return { data, sha: json.sha };
}

async function saveFile(data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const body = { message: 'Update recipes', content };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`, {
    method: 'PUT', headers: ghHeaders, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub PUT fehler: ${res.status}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── KI-Modus: prompt ohne recipe-Objekt = Rezept generieren oder Gesundheitstipp ──
    if (req.method === 'POST' && req.body && req.body.prompt && !req.body.recipe) {
      if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY fehlt' });

      const { prompt, systemPrompt } = req.body;

      const isHealthTip = !!systemPrompt;
      const sysMsg = systemPrompt || `Du bist ein veganer Ernährungsexperte und Sportmediziner. Erstelle ein veganes, glutenreduziertes Rezept passend für einen Läufer (30-40km/Woche, Ziel: Gewichtszunahme auf 70kg, 2700kcal/Tag, 100g Protein). Antworte NUR als JSON ohne Markdown-Backticks. Das Feld "kategorie" MUSS exakt eine dieser Optionen sein: "🌅 Frühstück", "🍽️ Mittag & Abend" oder "🎂 Kuchen & Backen". Format: {"name":"...","meta":"⏱ X Min · Y Portionen","kategorie":"🍽️ Mittag & Abend","zutaten":["..."],"schritte":["..."],"naehr":"~X kcal · ~Xg Protein · ...","tipp":"..."}`;

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: sysMsg },
            { role: 'user', content: prompt }
          ],
          max_tokens: 1000,
          temperature: 0.7,
        })
      });

      if (!groqRes.ok) {
        const err = await groqRes.text();
        return res.status(500).json({ error: `Groq Fehler: ${err.slice(0,200)}` });
      }

      const groqData = await groqRes.json();
      const text = groqData.choices?.[0]?.message?.content || '';

      if (isHealthTip) {
        return res.status(200).json({ result: text });
      }

      // Parse JSON recipe
      const clean = text.replace(/```json|```/g, '').trim();
      let recipe;
      try { recipe = JSON.parse(clean); }
      catch(e) { return res.status(500).json({ error: 'Rezept konnte nicht geparst werden: ' + clean.slice(0,100) }); }

      return res.status(200).json(recipe);
    }

    // ── CRUD-Modus ──
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO)
      return res.status(500).json({ error: 'Server nicht konfiguriert' });

    if (req.method === 'GET') {
      const { data } = await getFile();
      return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const { recipe } = req.body;
      if (!recipe || !recipe.name) return res.status(400).json({ error: 'Kein Rezept' });
      const { data, sha } = await getFile();
      data.push({ ...recipe, savedAt: new Date().toISOString() });
      await saveFile(data, sha);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const { index } = req.body;
      const { data, sha } = await getFile();
      data.splice(index, 1);
      await saveFile(data, sha);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
