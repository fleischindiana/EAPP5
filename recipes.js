import Redis from 'ioredis';
let _redis;
function getRedis() {
  if (!_redis) _redis = new Redis(process.env.WEIGHT_STORAGE_REDIS_URL);
  return _redis;
}
async function redisGet(key) {
  const val = await getRedis().get(key);
  return val ? JSON.parse(val) : null;
}
async function redisSet(key, data) {
  await getRedis().set(key, JSON.stringify(data));
}

const GROQ_API_KEY = process.env.GROQ_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // KI-Modus
    if (req.method === 'POST' && req.body?.prompt && !req.body?.recipe) {
      if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY fehlt' });

      const { prompt, systemPrompt } = req.body;
      const isHealthTip = !!systemPrompt;
      const sysMsg = systemPrompt || `Du bist ein veganer Ernährungsexperte und Sportmediziner. Erstelle ein veganes, glutenreduziertes Rezept passend für einen Läufer (30-40km/Woche, Ziel: Gewichtszunahme auf 70kg, 2700kcal/Tag, 100g Protein). Antworte NUR als JSON ohne Markdown-Backticks. Das Feld "kategorie" MUSS exakt eine dieser Optionen sein: "🌅 Frühstück", "🍽️ Mittag & Abend" oder "🎂 Kuchen & Backen". Format: {"name":"...","meta":"⏱ X Min · Y Portionen","kategorie":"🍽️ Mittag & Abend","zutaten":["..."],"schritte":["..."],"naehr":"~X kcal · ~Xg Protein · ...","tipp":"..."}`;

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }],
          max_tokens: 1000, temperature: 0.7,
        })
      });

      if (!groqRes.ok) {
        const err = await groqRes.text();
        return res.status(500).json({ error: `Groq Fehler: ${err.slice(0,200)}` });
      }

      const groqData = await groqRes.json();
      const text = groqData.choices?.[0]?.message?.content || '';

      if (isHealthTip) return res.status(200).json({ result: text });

      const clean = text.replace(/```json|```/g, '').trim();
      let recipe;
      try { recipe = JSON.parse(clean); }
      catch(e) { return res.status(500).json({ error: 'Parse-Fehler: ' + clean.slice(0,100) }); }
      return res.status(200).json(recipe);
    }

    // CRUD-Modus
    if (req.method === 'GET') {
      const data = await redisGet('recipes') || [];
      return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const { recipe } = req.body;
      if (!recipe || !recipe.name) return res.status(400).json({ error: 'Kein Rezept' });
      const data = await redisGet('recipes') || [];
      data.push({ ...recipe, savedAt: new Date().toISOString() });
      await redisSet('recipes', data);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const { index } = req.body;
      const data = await redisGet('recipes') || [];
      data.splice(index, 1);
      await redisSet('recipes', data);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
