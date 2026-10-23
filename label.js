const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const PORT = 3100;
const SAMPLE_SIZE = 1000;
const TYPES = ['military', 'diplomatic', 'humanitarian'];

const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'articles.db');
const sampleFile = path.join(dataDir, 'label-sample.json');
const labelsFile = path.join(dataDir, 'labels.json');
const freezeFile = path.join(__dirname, 'freeze.json');

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

function freezeAt() {
  if (process.env.FREEZE_AT) return process.env.FREEZE_AT;
  const f = readJSON(freezeFile, null);
  return f && f.at ? f.at : null;
}

const getSeen = db.prepare('SELECT first_seen_at FROM articles WHERE id = ?');

function isTestSet(label) {
  const at = freezeAt();
  if (!at) return false;
  const row = getSeen.get(label.id);
  return !!row && row.first_seen_at >= at;
}

function topUpSample() {
  const sample = readJSON(sampleFile, []);
  if (sample.length >= SAMPLE_SIZE) return sample;
  const have = new Set(sample);
  const pool = db
    .prepare('SELECT id FROM articles')
    .all()
    .map(r => r.id)
    .filter(id => !have.has(id));
  if (!pool.length) return sample;
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const next = sample.concat(pool.slice(0, SAMPLE_SIZE - sample.length));
  writeJSON(sampleFile, next);
  return next;
}

const getArticle = db.prepare(
  'SELECT id, title, description, source, type, first_seen_at FROM articles WHERE id = ?'
);

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
  const progress = {
    done: done.size,
    total: sample.length,
    frozen: !!freezeAt(),
    testSet: labels.filter(isTestSet).length
  };
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
  let also = (req.body || {}).also || null;

  if (!TYPES.includes(label) && label !== 'offtopic') {
    return res.status(400).json({ error: 'Invalid label' });
  }
  if (also !== null) {
    if (!TYPES.includes(label) || !TYPES.includes(also) || also === label) {
      return res.status(400).json({ error: 'Invalid second type' });
    }
  }

  const sample = readJSON(sampleFile, []);
  if (!sample.includes(id)) return res.status(400).json({ error: 'Not in sample' });
  const labels = readJSON(labelsFile, []);
  if (labels.some(l => l.id === id)) return res.status(409).json({ error: 'Already labelled' });
  const a = getArticle.get(id);
  if (!a) return res.status(404).json({ error: 'Article not found' });

  labels.push({
    id,
    title: a.title,
    predicted: a.type,
    label,
    also,
    at: new Date().toISOString()
  });
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
  const all = readJSON(labelsFile, []);
  const scope = req.query.scope === 'test' ? 'test' : 'all';
  const labels = scope === 'test' ? all.filter(isTestSet) : all;

  const counted = labels.filter(l => TYPES.includes(l.label));
  const n = counted.length;
  const strict = counted.filter(l => l.predicted === l.label).length;
  const lenient = counted.filter(l => l.predicted === l.label || l.predicted === l.also).length;
  const [sLow, sHigh] = wilson(strict, n);
  const [lLow, lHigh] = wilson(lenient, n);

  const truth = {};
  const guess = {};
  TYPES.forEach(t => { truth[t] = 0; guess[t] = 0; });
  counted.forEach(l => {
    truth[l.label]++;
    if (guess[l.predicted] !== undefined) guess[l.predicted]++;
  });
  const majorityCount = n ? Math.max(...TYPES.map(t => truth[t])) : 0;
  const majorityType = n ? TYPES.find(t => truth[t] === majorityCount) : null;
  const [bLow, bHigh] = wilson(majorityCount, n);

  let kappa = null;
  if (n) {
    const pe = TYPES.reduce((s, t) => s + (guess[t] / n) * (truth[t] / n), 0);
    kappa = pe < 1 ? (strict / n - pe) / (1 - pe) : null;
  }

  const matrix = {};
  TYPES.forEach(p => {
    matrix[p] = {};
    TYPES.forEach(h => { matrix[p][h] = 0; });
  });
  counted.forEach(l => {
    if (matrix[l.predicted]) matrix[l.predicted][l.label]++;
  });

  const perType = TYPES.map(t => {
    const both = matrix[t][t];
    return {
      type: t,
      siteSaid: guess[t],
      yours: truth[t],
      both,
      precision: guess[t] ? both / guess[t] : null,
      recall: truth[t] ? both / truth[t] : null
    };
  });

  res.json({
    scope,
    frozen: !!freezeAt(),
    labelled: labels.length,
    offtopic: labels.filter(l => l.label === 'offtopic').length,
    unsureOld: labels.filter(l => l.label === 'unsure').length,
    counted: n,
    strict,
    strictRange: [sLow, sHigh],
    lenient,
    lenientRange: [lLow, lHigh],
    alsoUsed: counted.filter(l => l.also).length,
    majorityType,
    majorityAccuracy: n ? majorityCount / n : null,
    majorityRange: [bLow, bHigh],
    kappa,
    matrix,
    perType,
    disagreements: counted
      .filter(l => l.predicted !== l.label)
      .map(l => ({
        title: l.title,
        predicted: l.predicted,
        label: l.label,
        also: l.also || null,
        lenientOk: l.predicted === l.also
      }))
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
h2 { font-size: 14px; text-transform: uppercase; margin: 14px 0 6px; }
#progress { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin: 6px 0 16px; }
.card { background: #fff; border: 1px solid #ccc; padding: 18px; }
#source { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
#title { font-size: 20px; font-weight: bold; line-height: 1.3; margin-bottom: 10px; }
#desc { font-size: 14px; color: #555; line-height: 1.45; }
.keys { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
button { font-family: inherit; font-size: 13px; font-weight: bold; padding: 12px 14px; background: #fff; border: 1px solid #111; cursor: pointer; text-transform: uppercase; }
button:hover { background: #e6e6e6; }
button.sel1 { background: #111; color: #fff; }
button.sel2 { background: #777; color: #fff; }
.hint { font-size: 11px; color: #666; margin-top: 12px; line-height: 1.5; }
.nav { margin-bottom: 14px; font-size: 12px; }
.nav a { color: #111; font-weight: bold; cursor: pointer; text-decoration: underline; margin-right: 14px; }
table { border-collapse: collapse; margin: 10px 0 18px; font-size: 13px; }
td, th { border: 1px solid #ccc; padding: 6px 10px; text-align: center; background: #fff; }
th { background: #eee; font-size: 11px; text-transform: uppercase; }
.big { font-size: 34px; font-weight: 900; }
.row { font-size: 13px; line-height: 1.5; }
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
      <button data-type="military">1 Military</button>
      <button data-type="diplomatic">2 Diplomatic</button>
      <button data-type="humanitarian">3 Humanitarian</button>
      <button id="save">Enter Save</button>
      <button id="offtopic">4 Not about the war</button>
      <button id="undo">Z Undo last</button>
    </div>
    <div class="hint">
      Press 1, 2 or 3 for the main type, then optionally a second number if it also fits another type. The first one you press counts as the main type. Press a number again to remove it. Then press Enter.<br>
      Press 4 only if the article is not really about the war. Do not use it for hard calls: pick your best guess instead.<br>
      Military: fighting, weapons, strikes, front line. Diplomatic: talks, sanctions, politics, leaders. Humanitarian: civilians, aid, refugees, rights.<br>
      Decide from the headline and snippet only. The site's own guess is hidden on purpose.
    </div>
  </div>

  <div id="view-results" style="display:none"></div>
</div>
<script>
const $ = id => document.getElementById(id);
const TYPES = ['military', 'diplomatic', 'humanitarian'];
let current = null;
let busy = false;
let selection = [];
let resultsScope = 'all';

function paintSelection() {
  document.querySelectorAll('[data-type]').forEach(b => {
    const i = selection.indexOf(b.dataset.type);
    b.classList.toggle('sel1', i === 0);
    b.classList.toggle('sel2', i === 1);
    const base = b.dataset.type === 'military' ? '1 Military' : b.dataset.type === 'diplomatic' ? '2 Diplomatic' : '3 Humanitarian';
    b.textContent = i === 0 ? base + ' (main)' : i === 1 ? base + ' (also)' : base;
  });
}

function toggle(type) {
  if (!current) return;
  const i = selection.indexOf(type);
  if (i >= 0) selection.splice(i, 1);
  else if (selection.length < 2) selection.push(type);
  paintSelection();
}

function show(view) {
  $('view-label').style.display = view === 'label' ? '' : 'none';
  $('view-results').style.display = view === 'results' ? '' : 'none';
  if (view === 'results') loadResults();
  else loadNext();
}

async function loadNext() {
  const res = await fetch('/api/next');
  const data = await res.json();
  $('progress').textContent = data.progress.done + ' of ' + data.progress.total + ' labelled' +
    (data.progress.frozen ? ' (' + data.progress.testSet + ' in the sealed test set)' : '');
  current = data.article;
  selection = [];
  paintSelection();
  if (!current) {
    $('source').textContent = '';
    $('title').textContent = 'All done for now.';
    $('desc').textContent = 'No unlabelled articles left. New ones appear here as the main server collects them. Open Results to see how the site\\'s guesses compare with yours.';
    $('keys').style.display = 'none';
    return;
  }
  $('keys').style.display = '';
  $('source').textContent = current.source || '';
  $('title').textContent = current.title;
  $('desc').textContent = current.description || '';
}

async function send(label, also) {
  if (!current || busy) return;
  busy = true;
  try {
    await fetch('/api/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: current.id, label, also: also || null })
    });
  } finally {
    busy = false;
  }
  await loadNext();
}

function save() {
  if (!selection.length) return;
  send(selection[0], selection[1] || null);
}

async function undo() {
  if (busy) return;
  busy = true;
  try { await fetch('/api/undo', { method: 'POST' }); } finally { busy = false; }
  await loadNext();
}

function pct(x) {
  return x === null || x === undefined ? 'n/a' : Math.round(x * 100) + '%';
}

async function loadResults() {
  const r = await (await fetch('/api/results?scope=' + resultsScope)).json();
  const box = $('view-results');
  box.textContent = '';

  function add(tag, text, cls) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    box.appendChild(el);
    return el;
  }

  const nav = document.createElement('div');
  nav.className = 'nav';
  [['all', 'All labels'], ['test', 'Sealed test set only']].forEach(([scope, text]) => {
    const a = document.createElement('a');
    a.textContent = scope === resultsScope ? '> ' + text : text;
    a.addEventListener('click', () => { resultsScope = scope; loadResults(); });
    nav.appendChild(a);
  });
  box.appendChild(nav);

  if (!r.counted) {
    add('p', resultsScope === 'test' && !r.frozen
      ? 'No test set is sealed yet. The test set is every article collected after the date in freeze.json, which you create when the model is frozen.'
      : 'No labels yet in this view.');
    return;
  }

  add('div', pct(r.strict / r.counted), 'big');
  add('p', 'Strict: the site\\'s guess matched your main type in ' + r.strict + ' of ' + r.counted + ' articles. 95% range: ' + pct(r.strictRange[0]) + ' to ' + pct(r.strictRange[1]) + '.', 'row');
  add('p', 'Lenient: the guess matched your main or second type in ' + r.lenient + ' of ' + r.counted + ' (' + pct(r.lenient / r.counted) + ', range ' + pct(r.lenientRange[0]) + ' to ' + pct(r.lenientRange[1]) + '). You gave a second type on ' + r.alsoUsed + ' articles.', 'row');
  add('p', 'Always guessing "' + r.majorityType + '" would score ' + pct(r.majorityAccuracy) + ' (range ' + pct(r.majorityRange[0]) + ' to ' + pct(r.majorityRange[1]) + '). Agreement beyond chance (kappa): ' + (r.kappa === null ? 'n/a' : r.kappa.toFixed(2)) + '.', 'row');
  add('p', r.offtopic + ' marked not about the war' + (r.unsureOld ? ', ' + r.unsureOld + ' marked unsure in the first batch' : '') + ' (neither counted above).', 'row');

  const table = document.createElement('table');
  const head = table.insertRow();
  head.appendChild(Object.assign(document.createElement('th'), { textContent: 'Site guessed ↓ / Your main type →' }));
  TYPES.forEach(t => head.appendChild(Object.assign(document.createElement('th'), { textContent: t })));
  TYPES.forEach(p => {
    const row = table.insertRow();
    row.appendChild(Object.assign(document.createElement('th'), { textContent: p }));
    TYPES.forEach(h => { row.insertCell().textContent = r.matrix[p][h]; });
  });
  box.appendChild(table);

  add('h2', 'Per type');
  r.perType.forEach(t => {
    add('p', t.type + ': site said ' + t.siteSaid + ', you said ' + t.yours + ', both ' + t.both + '. When the site says it, you agree ' + pct(t.precision) + '. Of yours, the site finds ' + pct(t.recall) + '.', 'row');
  });

  add('h2', 'Where it disagreed with your main type');
  if (!r.disagreements.length) add('p', 'Nowhere.');
  r.disagreements.forEach(d => {
    const div = document.createElement('div');
    div.className = 'dis';
    div.textContent = d.title + ' ';
    const s = document.createElement('span');
    s.textContent = '(site: ' + d.predicted + ', you: ' + d.label + (d.also ? ' + ' + d.also : '') + (d.lenientOk ? ', counts as lenient match' : '') + ')';
    div.appendChild(s);
    box.appendChild(div);
  });
}

document.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => toggle(b.dataset.type)));
$('save').addEventListener('click', save);
$('offtopic').addEventListener('click', () => send('offtopic', null));
$('undo').addEventListener('click', undo);
$('nav-label').addEventListener('click', () => show('label'));
$('nav-results').addEventListener('click', () => show('results'));

document.addEventListener('keydown', e => {
  if ($('view-label').style.display === 'none') return;
  if (e.key === '1') toggle('military');
  else if (e.key === '2') toggle('diplomatic');
  else if (e.key === '3') toggle('humanitarian');
  else if (e.key === '4') send('offtopic', null);
  else if (e.key === 'Enter') save();
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
  console.log('1/2/3 pick types (first = main), Enter saves, 4 = not about the war, Z undoes.');
  console.log('Labels are saved to data/labels.json');
});