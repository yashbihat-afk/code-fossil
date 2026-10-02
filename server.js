const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const cache = new Map();

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 }).trim();
}

function isRemote(value) { return /^(https?:\/\/|git@|ssh:\/\/)/i.test(value); }
function repoName(value) { return path.basename(value.replace(/[\\/]$/, '')).replace(/\.git$/i, '') || 'repository'; }

function prepareRepo(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Repository path or URL is required.');
  if (!isRemote(value)) {
    const resolved = path.resolve(value);
    if (!fs.existsSync(path.join(resolved, '.git'))) throw new Error('That folder is not a Git repository.');
    return { path: resolved, cleanup: false, name: repoName(resolved) };
  }
  const key = crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
  const target = path.join(os.tmpdir(), `code-fossil-${key}`);
  if (!fs.existsSync(path.join(target, '.git'))) execFileSync('git', ['clone', '--depth', '200', value, target], { encoding: 'utf8', stdio: 'pipe' });
  return { path: target, cleanup: false, name: repoName(value) };
}

function parseHistory(repo) {
  const raw = git(repo, ['log', '-n', '160', '--date=short', '--pretty=format:%H%x09%ad%x09%s', '--name-only']);
  const commits = [];
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([0-9a-f]{7,40})\t(\d{4}-\d{2}-\d{2})\t(.+)$/);
    if (match) { current = { hash: match[1], date: match[2], subject: match[3], files: [] }; commits.push(current); continue; }
    if (current && !line.includes('\t') && !line.startsWith('commit ')) current.files.push(line.trim());
  }
  return commits.filter(c => c.files.length);
}

function ageYears(date) { return Math.max(0, (Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / 31557600000); }
function analyze(repoInput) {
  const prepared = prepareRepo(repoInput);
  const commits = parseHistory(prepared.path);
  const totalCommits = Number(git(prepared.path, ['rev-list', '--count', 'HEAD']) || commits.length);
  const fileMap = new Map(); const pairMap = new Map(); let astEvents = 0;
  const timeline = commits.slice(0, 30).map(c => {
    const subject = c.subject; const lower = subject.toLowerCase();
    const bug = /fix|bug|patch|hotfix|rollback|issue|regression/.test(lower);
    const structural = /refactor|extract|split|rename|move|merge|deprecate|migrat|reorganiz/.test(lower) || c.files.length >= 5;
    const type = bug ? 'bug' : structural ? 'refactor' : 'feature';
    if (structural) astEvents += Math.max(1, c.files.length);
    c.files.slice(0, 24).forEach(file => {
      if (!fileMap.has(file)) fileMap.set(file, { name: file, changes: 0, bugFixes: 0, firstSeen: c.date, lastSeen: c.date });
      const item = fileMap.get(file); item.changes++; item.lastSeen = item.lastSeen < c.date ? item.lastSeen : c.date; if (bug) item.bugFixes++;
    });
    const unique = [...new Set(c.files)].slice(0, 14);
    for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) { const key = [unique[i], unique[j]].sort().join('\0'); pairMap.set(key, (pairMap.get(key) || 0) + 1); }
    return { date: c.date, type, title: subject, copy: `${c.files.length} files changed · ${c.hash.slice(0, 8)}`, tag: type === 'bug' ? 'SCAR TISSUE' : type === 'refactor' ? 'STRUCTURAL' : 'FEATURE' };
  });
  const ranked = [...fileMap.values()].map(item => ({ ...item, coupling: 0, age: ageYears(item.firstSeen) })).sort((a, b) => b.changes - a.changes);
  const edges = [...pairMap.entries()].map(([key, weight]) => { const [source, target] = key.split('\0'); return { source, target, weight }; }).sort((a, b) => b.weight - a.weight).slice(0, 24);
  const couplingByFile = new Map(); edges.forEach(e => { couplingByFile.set(e.source, (couplingByFile.get(e.source) || 0) + e.weight); couplingByFile.set(e.target, (couplingByFile.get(e.target) || 0) + e.weight); });
  ranked.forEach(item => { item.coupling = Math.min(0.99, ((couplingByFile.get(item.name) || 0) / Math.max(1, item.changes * 4)) + 0.2); item.risk = item.bugFixes >= 4 || item.changes >= 18 ? 'high' : item.bugFixes >= 2 || item.changes >= 10 ? 'med' : 'low'; });
  const fileRows = ranked.slice(0, 30).map(item => [item.name, item.coupling.toFixed(2), `${item.age.toFixed(1)} yrs`, item.risk]);
  const hotspots = ranked.filter(x => x.risk !== 'low').slice(0, 12).map(item => [item.name, item.coupling.toFixed(2), String(item.changes), String(item.bugFixes), item.risk]);
  const firstDate = commits.length ? commits[commits.length - 1].date : new Date().toISOString().slice(0, 10);
  const latest = commits[0];
  return { repo: prepared.name, summary: { totalCommits, files: fileMap.size, astEvents, ageYears: ageYears(firstDate), hotspots: hotspots.length, coupling: edges[0] ? Math.min(0.99, edges[0].weight / 10) : 0 }, timeline, hotspots, files: fileRows, graph: { nodes: ranked.slice(0, 12).map(x => x.name), edges }, latest: latest ? { date: latest.date, subject: latest.subject } : null };
}

function send(res, status, payload, type = 'application/json') { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Access-Control-Allow-Origin': '*' }); res.end(type === 'application/json' ? JSON.stringify(payload) : payload); }
function staticFile(req, res) { const requested = req.url === '/' ? 'index.html' : req.url.slice(1); const safe = path.normalize(requested).replace(/^([.][.][\\/])+/, ''); const file = path.join(ROOT, safe); if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain'); const ext = path.extname(file); const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }; send(res, 200, fs.readFileSync(file), types[ext] || 'application/octet-stream'); }

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.url.startsWith('/api/analyze')) {
    let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { try { const input = JSON.parse(body || '{}').repo; const key = String(input); if (!cache.has(key)) cache.set(key, analyze(input)); send(res, 200, cache.get(key)); } catch (error) { send(res, 400, { error: error.message }); } }); return;
  }
  staticFile(req, res);
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.log(`Code Fossil is already running at http://localhost:${PORT}`);
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
});
server.listen(PORT, () => console.log(`Code Fossil running at http://localhost:${PORT}`));
