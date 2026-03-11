const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const FILE_PATH = 'data/recipes.json';

const headers = {
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

async function getFile() {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`, { headers });
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
    method: 'PUT', headers, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub PUT fehler: ${res.status}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO)
    return res.status(500).json({ error: 'Server nicht konfiguriert' });

  try {
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
