import { redisGet, redisSet } from './redis.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const data = await redisGet('weight') || [];
      return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const { data } = req.body;
      if (!Array.isArray(data)) return res.status(400).json({ error: 'Ungültige Daten' });
      await redisSet('weight', data);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
