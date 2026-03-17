import { redisGet, redisSet } from './redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const data = await redisGet('health') || [];
      return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const { entry } = req.body;
      if (!entry || !entry.prompt) return res.status(400).json({ error: 'Kein Eintrag' });
      const data = await redisGet('health') || [];
      data.unshift({ ...entry, date: new Date().toISOString() });
      await redisSet('health', data);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const { index } = req.body;
      const data = await redisGet('health') || [];
      data.splice(index, 1);
      await redisSet('health', data);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
