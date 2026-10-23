const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const PORT = 3100;
const SAMPLE_SIZE = 100;
const TYPES = ['military', 'diplomatic', 'humanitarian'];

const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'articles.db');
const sampleFile = path.join(dataDir, 'label-sample.json');
const labelsFile = path.join(dataDir, 'labels.json');

if (!fs.existsSync(dbFile)) {
  console.error('No database found at ' + dbFile + '. Run the main server first.');
  process.exit(1);
}

const db = new Database(dbFile, { readonly: true, fileMustExist: true });

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function topUpSample() {
  const sample = readJSON(sampleFile, []);
  if (sample.length >= SAMPLE_SIZE) return sample;
  const have = new Set(sample);
  const pool = db.prepare('SELECT id FROM articles').all().map(r => r.id).filter(id => !have.has(id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const next = sample.concat(pool.slice(0, SAMPLE_SIZE - sample.length));
  writeJSON(sampleFile, next);
  return next;
}

const getArticle = db.prepare('SELECT id, title, description, source, type FROM articles WHERE id = ?');

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(centre - margin) / denom, (centre + margin) / denom];
}

const app = express();
app.use(express.json());

app.get('/api/next', (req, res) => {
  const sample = topUpSample();
  const labels = readJSON(labelsFile, []);
  const done = new Set(labels.map(l => l.id));
  const nextId = sample.find(id => !done.has(id));
  const progress = { done: done.size, total: sample.length };
  if (nextId === undefined) return res.json({ article: null, progress });
  const a = getArticle.get(nextId);
  if (!a) return res.json({ article: null, progress });
  res.json({
    article: { id: a.id, title: a.title, description: a.description, source: a.source },
    progress
  });
});

app.post('/api/label', (req, res) => {
  const { id, label } = req.body || {};
  if (!TYPES.includes(label) && label !== 'unsure') {
    return res.status(400).json({ error: 'Invalid label' });
  }
  const sample = readJSON(sampleFile, []);
  if (!sample.includes(id)) return res.status(400).json({ error: 'Not in sample' });
  const labels = readJSON(labelsFile, []);
  if (labels.some(l => l.id === id)) return res.status(409).json({ error: 'Already labelled' });
  const a = getArticle.get(id);
  if (!a) return res.status(404).json({ error: 'Article not found' });
  labels.push({ id, title: a.title, predicted: a.type, label, at: new Date().toISOString() });
  writeJSON(labelsFile, labels);
  res.json({ ok: true });
});

app.post('/api/undo', (req, res) => {
  const labels = readJSON(labelsFile, []);
  const removed = labels.pop();
  writeJSON(labelsFile, labels);
  res.json({ ok: true, removed: removed ? removed.id : null });
});

app.get('/api/results', (req, res) => {
  const labels = readJSON(labelsFile, []);
  const counted = labels.filter(l => TYPES.includes(l.label));
  const correct = counted.filter(l => l.predicted === l.label).length;
  const [low, high] = wilson(correct, counted.length);

  const matrix = {};
  TYPES.forEach(p => {
    matrix[p] = {};
    TYPES.forEach(h => { matrix[p][h] = 0; });
  });
  counted.forEach(l => {
    if (matrix[l.predicted]) matrix[l.predicted][l.label]++;
  });

  res.json({
    labelled: labels.length,
    unsure: labels.length - counted.length,
    counted: counted.length,
    correct,
    accuracy: counted.length ? correct / counted.length : null,
    low,
    high,
    matrix,
    disagreements: counted
      .filter(l => l.predicted !== l.label)
      .map(l => ({ title: l.title, predicted: l.predicted, label: l.label }))
  });
});

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Label articles</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; background: #f2f2f2; color: #111; }
#wrap { max-width: 720px; margin: 0 auto; padding: 24px 16px 60px; }
h1 { font-size: 22px; font-weight: 900; text-transform: uppercase; }
#progress { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin: 6px 0 16px; }
.card { background: #fff; border: 1px solid #ccc; padding: 18px; }
#source { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
#title { font-size: 20px; font-weight: bold; line-height: 1.3; margin-bottom: 10px; }
#desc { font-size: 14px; color: #555; line-height: 1.45; }
.keys { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
button { font-family: inherit; font-size: 13px; font-weight: bold; padding: 12px 14px; background: #fff; border: 1px solid #111; cursor: pointer; text-transform: uppercase; }
button:hover { background: #e6e6e6; }
.hint { font-size: 11px; color: #666; margin-top: 12px; line-height: 1.5; }
.nav { margin-bottom: 14px; font-size: 12px; }
.nav a { color: #111; font-weight: bold; cursor: pointer; text-decoration: underline; margin-right: 14px; }
table { border-collapse: collapse; margin: 10px 0 18px; font-size: 13px; }
td, th { border: 1px solid #ccc; padding: 6px 10px; text-align: center; background: #fff; }
th { background: #eee; font-size: 11px; text-transform: uppercase; }
.big { font-size: 34px; font-weight: 900; }
.dis { font-size: 13px; line-height: 1.4; padding: 8px 0; border-bottom: 1px solid #ddd; }
.dis span { color: #999; font-size: 11px; text-transform: uppercase; }
</style>
</head>
<body>
<div id="wrap">
  <h1>Label articles</h1>
  <div class="nav"><a id="nav-label">Label</a><a id="nav-results">Results</a></div>

  <div id="view-label">
    <div id="progress"></div>
    <div class="card" id="card">
      <div id="source"></div>
      <div id="title"></div>
      <div id="desc"></div>
    </div>
    <div class="keys" id="keys">
      <button data-label="military">1 Military</button>
      <button data-label="diplomatic">2 Diplomatic</button>
      <button data-label="humanitarian">3 Humanitarian</button>
      <button data-label="unsure">4 Unsure / fits none</button>
      <button id="undo">Z Undo last</button>
    </div>
    <div class="hint">
      Military: fighting, weapons, strikes, front line. Diplomatic: talks, sanctions, politics, leaders. Humanitarian: civilians, aid, refugees, rights.<br>
      Decide from the headline and snippet only. The site's own guess is hidden on purpose.
    </div>
  </div>

  <div id="view-results" style="display:none"></div>
</div>
<script>
const $ = id => document.getElementById(id);
let current = null;
let busy = false;

function show(view) {
  $('view-label').style.display = view === 'label' ? '' : 'none';
  $('view-results').style.display = view === 'results' ? '' : 'none';
  if (view === 'results') loadResults();
  else loadNext();
}

async function loadNext() {
  const res = await fetch('/api/next');
  const data = await res.json();
  $('progress').textContent = data.progress.done + ' of ' + data.progress.total + ' labelled';
  current = data.article;
  if (!current) {
    $('source').textContent = '';
    $('title').textContent = 'All done.';
    $('desc').textContent = 'Open Results to see how the site\\'s guesses compare with yours.';
    $('keys').style.display = 'none';
    return;
  }
  $('keys').style.display = '';
  $('source').textContent = current.source || '';
  $('title').textContent = current.title;
  $('desc').textContent = current.description || '';
}

async function label(value) {
  if (!current || busy) return;
  busy = true;
  try {
    await fetch('/api/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: current.id, label: value })
    });
  } finally {
    busy = false;
  }
  await loadNext();
}

async function undo() {
  if (busy) return;
  busy = true;
  try { await fetch('/api/undo', { method: 'POST' }); } finally { busy = false; }
  await loadNext();
}

async function loadResults() {
  const r = await (await fetch('/api/results')).json();
  const box = $('view-results');
  box.textContent = '';

  function add(tag, text, cls) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    box.appendChild(el);
    return el;
  }

  if (!r.counted) {
    add('p', 'No labels yet.');
    return;
  }

  add('div', Math.round(r.accuracy * 100) + '%', 'big');
  add('p', r.correct + ' of ' + r.counted + ' guesses matched you. 95% range: ' +
    Math.round(r.low * 100) + '% to ' + Math.round(r.high * 100) + '%. ' +
    r.unsure + ' marked unsure and not counted.');

  const types = ['military', 'diplomatic', 'humanitarian'];
  const table = document.createElement('table');
  const head = table.insertRow();
  head.appendChild(Object.assign(document.createElement('th'), { textContent: 'Site guessed ↓ / You said →' }));
  types.forEach(t => head.appendChild(Object.assign(document.createElement('th'), { textContent: t })));
  types.forEach(p => {
    const row = table.insertRow();
    row.appendChild(Object.assign(document.createElement('th'), { textContent: p }));
    types.forEach(h => { row.insertCell().textContent = r.matrix[p][h]; });
  });
  box.appendChild(table);

  add('h2', 'Where it disagreed with you');
  if (!r.disagreements.length) add('p', 'Nowhere.');
  r.disagreements.forEach(d => {
    const div = document.createElement('div');
    div.className = 'dis';
    div.textContent = d.title + ' ';
    const s = document.createElement('span');
    s.textContent = '(site: ' + d.predicted + ', you: ' + d.label + ')';
    div.appendChild(s);
    box.appendChild(div);
  });
}

document.querySelectorAll('[data-label]').forEach(b => b.addEventListener('click', () => label(b.dataset.label)));
$('undo').addEventListener('click', undo);
$('nav-label').addEventListener('click', () => show('label'));
$('nav-results').addEventListener('click', () => show('results'));

document.addEventListener('keydown', e => {
  if ($('view-label').style.display === 'none') return;
  if (e.key === '1') label('military');
  else if (e.key === '2') label('diplomatic');
  else if (e.key === '3') label('humanitarian');
  else if (e.key === '4') label('unsure');
  else if (e.key === 'z' || e.key === 'Z') undo();
});

loadNext();
</script>
</body>
</html>`;

app.get('/', (req, res) => {
  res.type('html').send(PAGE);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log('Labelling tool: http://localhost:' + PORT);
  console.log('Press 1 / 2 / 3 / 4 to label, Z to undo. Labels are saved to data/labels.json');
});