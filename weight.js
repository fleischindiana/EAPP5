import { kv } from '@vercel/kv';

const KEY = 'weight_christian';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    const data = await kv.get(KEY);
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const { data } = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ error: 'Ungültige Daten' });
    await kv.set(KEY, data);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
