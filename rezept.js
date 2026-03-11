export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, systemPrompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Kein Prompt' });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: 'Server nicht konfiguriert' });

  const isHealthTip = !!systemPrompt;

  const defaultSystem = `Du bist veganer Ernaehrungsberater fuer Christian (34J, Laeufer 30-40km/Woche, Ziel 70kg, Kalium-Mangel, glutenreduziert, 100g Protein/Tag, 2700 kcal). Antworte AUSSCHLIESSLICH mit einem einzigen JSON-Objekt. Kein Text davor, kein Text danach, keine Backticks, kein Markdown. Format: {"name":"...","meta":"X Min · Y Portionen","zutaten":["..."],"schritte":["..."],"naehr":"~XXX kcal · ~XXg Protein","tipp":"..."}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt || defaultSystem },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    let text = data.choices[0].message.content.trim();
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (isHealthTip) {
      return res.status(200).json({ result: text });
    }

    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Kein gueltiges Rezept erhalten');
    const recipe = JSON.parse(match[0]);
    return res.status(200).json(recipe);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
