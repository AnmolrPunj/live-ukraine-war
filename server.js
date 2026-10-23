require('dotenv').config();
const express = require('express');
const axios = require('axios');
const RSSParser = require('rss-parser');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const parser = new RSSParser({ timeout: 10000 });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const dataDir = path.join(__dirname, 'data');
const frontlineDir = path.join(dataDir, 'frontline');
const geonamesFile = path.join(dataDir, 'geonames', 'UA.txt');
fs.mkdirSync(frontlineDir, { recursive: true });
fs.mkdirSync(path.dirname(geonamesFile), { recursive: true });

const CANONICAL = {
  'Kiev': 'Kyiv',
  'Odessa': 'Odesa',
  'Nikolaev': 'Mykolaiv',
  'Zaporizhzhya': 'Zaporizhzhia',
  'Izyum': 'Izium',
  'Sievierodonetsk': 'Severodonetsk'
};

const CITY_COORDS = {
  'Kyiv': [50.4501, 30.5234],
  'Kiev': [50.4501, 30.5234],
  'Kharkiv': [49.9935, 36.2304],
  'Odesa': [46.4825, 30.7233],
  'Odessa': [46.4825, 30.7233],
  'Dnipro': [48.4647, 35.0462],
  'Donetsk': [48.0159, 37.8029],
  'Zaporizhzhia': [47.8388, 35.1396],
  'Zaporizhzhya': [47.8388, 35.1396],
  'Kherson': [46.6354, 32.6169],
  'Mykolaiv': [46.9750, 31.9946],
  'Nikolaev': [46.9750, 31.9946],
  'Mariupol': [47.0971, 37.5077],
  'Luhansk': [48.5740, 39.3078],
  'Sumy': [50.9077, 34.7981],
  'Chernihiv': [51.4982, 31.2893],
  'Poltava': [49.5883, 34.5514],
  'Lviv': [49.8397, 24.0297],
  'Kramatorsk': [48.7239, 37.5556],
  'Bakhmut': [48.5957, 38.0],
  'Avdiivka': [48.1382, 37.7491],
  'Kursk': [51.7373, 36.1873],
  'Sloviansk': [48.8619, 37.6247],
  'Melitopol': [46.8493, 35.3682],
  'Berdiansk': [46.7569, 36.7892],
  'Zhytomyr': [50.2547, 28.6587],
  'Vinnytsia': [49.2331, 28.4682],
  'Severodonetsk': [48.9480, 38.4897],
  'Sievierodonetsk': [48.9480, 38.4897],
  'Lysychansk': [48.9001, 38.4432],
  'Toretsk': [48.4012, 37.8536],
  'Pokrovsk': [48.2828, 37.1756],
  'Nikopol': [47.5748, 34.3974],
  'Chasiv Yar': [48.5724, 37.8604],
  'Kupiansk': [49.7107, 37.6001],
  'Lyman': [48.9785, 37.8126],
  'Belgorod': [50.5977, 36.5882],
  'Oleshky': [46.6027, 32.6569],
  'Izium': [49.2082, 37.2762],
  'Izyum': [49.2082, 37.2762],
  'Vuhledar': [47.8274, 37.2509],
  'Marinka': [47.9558, 37.5136],
  'Orikhiv': [47.5632, 35.7862],
  'Robotyne': [47.4553, 35.8321],
  'Kreminna': [49.0572, 38.2131],
  'Svatove': [49.4063, 38.1548],
  'Lozova': [48.8884, 36.3186],
  'Enerhodar': [47.4986, 34.6564],
  'Huliaipole': [47.6606, 36.2573]
};

const ARTICLE_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  raw_text TEXT,
  city TEXT,
  lat REAL,
  lng REAL,
  type TEXT NOT NULL,
  source TEXT,
  published_at TEXT,
  first_seen_at TEXT NOT NULL,
  sort_date TEXT NOT NULL
`;

const db = new Database(path.join(dataDir, 'articles.db'));

db.exec(`CREATE TABLE IF NOT EXISTS articles (${ARTICLE_COLUMNS})`);

const existingColumns = db.prepare('PRAGMA table_info(articles)').all();
const cityColumn = existingColumns.find(c => c.name === 'city');

if (cityColumn && cityColumn.notnull === 1) {
  console.log('Migrating articles table to allow unpinned articles...');
  const migrate = db.transaction(() => {
    db.exec(`CREATE TABLE articles_new (${ARTICLE_COLUMNS})`);
    db.exec(`
      INSERT INTO articles_new
        (id, link, title, description, raw_text, city, lat, lng, type, published_at, first_seen_at, sort_date)
      SELECT
        id, link, title, description, raw_text, city, lat, lng, type, published_at, first_seen_at, sort_date
      FROM articles
    `);
    db.exec('DROP TABLE articles');
    db.exec('ALTER TABLE articles_new RENAME TO articles');
  });
  migrate();
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_articles_sort ON articles(sort_date);
  CREATE INDEX IF NOT EXISTS idx_articles_city_sort ON articles(city, sort_date);
`);

const canonicalizeCity = db.prepare('UPDATE articles SET city = ? WHERE city = ?');
for (const [alias, canonical] of Object.entries(CANONICAL)) {
  canonicalizeCity.run(canonical, alias);
}

const insertArticle = db.prepare(`
  INSERT OR IGNORE INTO articles
    (link, title, description, raw_text, city, lat, lng, type, source, published_at, first_seen_at, sort_date)
  VALUES
    (@link, @title, @description, @raw_text, @city, @lat, @lng, @type, @source, @published_at, @first_seen_at, @sort_date)
`);

const insertMany = db.transaction((rows) => {
  let added = 0;
  for (const row of rows) {
    added += insertArticle.run(row).changes;
  }
  return added;
});

const countArticles = db.prepare('SELECT COUNT(*) AS n FROM articles');
const countPinned = db.prepare('SELECT COUNT(*) AS n FROM articles WHERE city IS NOT NULL');
const selectUnpinned = db.prepare('SELECT id, title, raw_text FROM articles WHERE city IS NULL');
const setPlace = db.prepare('UPDATE articles SET city = ?, lat = ?, lng = ? WHERE id = ?');

const FRONTLINE_REPO = 'cyterat/deepstate-map-data';
const FRONTLINE_BRANCH = 'main';
const FRONTLINE_TREE_URL = `https://api.github.com/repos/${FRONTLINE_REPO}/git/trees/${FRONTLINE_BRANCH}?recursive=1`;
const FRONTLINE_RAW_URL = `https://raw.githubusercontent.com/${FRONTLINE_REPO}/${FRONTLINE_BRANCH}/data/`;
const FRONTLINE_REMOTE_PATH = /^data\/(deepstatemap_data_\d{8}\.geojson)$/;
const FRONTLINE_LOCAL_NAME = /^deepstatemap_data_\d{8}\.geojson$/;

function localFrontlineFiles() {
  return fs.readdirSync(frontlineDir).filter(name => FRONTLINE_LOCAL_NAME.test(name)).sort();
}

function frontlineDateFromName(name) {
  const m = name.match(/(\d{4})(\d{2})(\d{2})/);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

let frontlineMemory = { name: null, body: null };

function loadLatestFrontline() {
  const files = localFrontlineFiles();
  if (!files.length) return null;
  const name = files[files.length - 1];
  if (frontlineMemory.name !== name) {
    frontlineMemory = {
      name,
      body: fs.readFileSync(path.join(frontlineDir, name), 'utf8')
    };
  }
  return frontlineMemory;
}

let syncingFrontline = false;

async function syncFrontline() {
  if (syncingFrontline) return;
  syncingFrontline = true;
  try {
    const have = new Set(localFrontlineFiles());
    const response = await axios.get(FRONTLINE_TREE_URL, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      timeout: 30000
    });
    if (response.data.truncated) {
      console.log('Frontline: GitHub truncated the file listing');
    }
    const remote = response.data.tree
      .map(entry => {
        const m = entry.path.match(FRONTLINE_REMOTE_PATH);
        return m ? m[1] : null;
      })
      .filter(Boolean)
      .sort();

    const missing = remote.filter(name => !have.has(name)).reverse();
    if (!missing.length) {
      console.log(`Frontline: up to date (${have.size} snapshots on disk)`);
      return;
    }

    console.log(`Frontline: downloading ${missing.length} missing snapshots, newest first...`);
    let downloaded = 0;

    const workers = Array.from({ length: 4 }, async () => {
      while (missing.length) {
        const name = missing.shift();
        try {
          const res = await axios.get(FRONTLINE_RAW_URL + name, {
            timeout: 30000,
            responseType: 'text',
            transformResponse: [(data) => data]
          });
          JSON.parse(res.data);
          const tmpPath = path.join(frontlineDir, name + '.tmp');
          fs.writeFileSync(tmpPath, res.data);
          fs.renameSync(tmpPath, path.join(frontlineDir, name));
          downloaded++;
        } catch (e) {
          console.log('Frontline: failed to download', name, '-', e.message);
        }
      }
    });

    await Promise.all(workers);
    console.log(`Frontline: downloaded ${downloaded}, ${localFrontlineFiles().length} snapshots on disk`);
  } catch (err) {
    console.error('Frontline sync failed:', err.message);
  } finally {
    syncingFrontline = false;
  }
}

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

app.get('/api/frontline', (req, res) => {
  const latest = loadLatestFrontline();
  if (!latest) {
    return res.status(503).json({ error: 'Frontline data is not available yet' });
  }
  res.type('application/json').send(latest.body);
});

app.get('/api/frontline-info', (req, res) => {
  const files = localFrontlineFiles();
  if (!files.length) {
    return res.json({ date: null, snapshots: 0 });
  }
  res.json({
    date: frontlineDateFromName(files[files.length - 1]),
    snapshots: files.length
  });
});

const MIN_POPULATION = 500;
const MIN_NAME_LENGTH = 4;
const ADMIN_CENTRE_CODES = new Set(['PPLC', 'PPLA', 'PPLA2', 'PPLA3']);
const AMBIGUOUS_NAMES = new Set([
  'nova', 'bila', 'hope', 'union', 'peace', 'victory', 'central', 'star',
  'general', 'center', 'centre', 'border', 'river', 'bank', 'port', 'line',
  'ukraine', 'ukraina', 'ukrayina', 'russia', 'donbas', 'crimea', 'nato', 'europe'
]);

const placeIndex = new Map();
const curatedByName = new Map();

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

for (const [name, coords] of Object.entries(CITY_COORDS)) {
  const canonical = CANONICAL[name] || name;
  const record = {
    name: canonical,
    lat: coords[0],
    lng: coords[1],
    population: Infinity,
    curated: true
  };
  placeIndex.set(normalizeName(name), record);
  if (!curatedByName.has(normalizeName(canonical))) {
    curatedByName.set(normalizeName(canonical), record);
  }
}

function loadPlaces() {
  if (!fs.existsSync(geonamesFile)) {
    console.log('GeoNames: data/geonames/UA.txt not found, using the built-in city list only');
    return;
  }

  const latinName = /^[A-Za-z][A-Za-z .'’-]*$/;
  const lines = fs.readFileSync(geonamesFile, 'utf8').split('\n');
  let places = 0;

  for (const line of lines) {
    if (!line) continue;
    const f = line.split('\t');
    if (f[6] !== 'P') continue;

    const population = parseInt(f[14], 10) || 0;
    if (population < MIN_POPULATION && !ADMIN_CENTRE_CODES.has(f[7])) continue;

    const lat = parseFloat(f[4]);
    const lng = parseFloat(f[5]);
    if (isNaN(lat) || isNaN(lng)) continue;

    const canonical = CANONICAL[f[1]] || f[1];
    const curated = curatedByName.get(normalizeName(canonical));
    const record = curated || { name: canonical, lat, lng, population, curated: false };

    const rawNames = [f[1], f[2]].concat(f[3] ? f[3].split(',') : []);
    for (const raw of rawNames) {
      const name = raw.trim();
      if (name.length < MIN_NAME_LENGTH || !latinName.test(name)) continue;
      const key = normalizeName(name);
      if (AMBIGUOUS_NAMES.has(key)) continue;
      const existing = placeIndex.get(key);
      if (existing && (existing.curated || existing.population >= population)) continue;
      placeIndex.set(key, record);
    }
    places++;
  }

  console.log(`GeoNames: ${places} places loaded, ${placeIndex.size} searchable names`);
}

function tokenize(text) {
  return (text.match(/[A-Za-z][A-Za-z'’]*/g) || []).map(t => t.replace(/['’]s$/i, ''));
}

function findPlace(text) {
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    for (let n = Math.min(3, tokens.length - i); n >= 1; n--) {
      const slice = tokens.slice(i, i + n);
      if (!slice.every(t => /^[A-Z]/.test(t))) continue;
      const place = placeIndex.get(normalizeName(slice.join(' ')));
      if (place) return place;
    }
  }
  return null;
}

const MILITARY = [
  'strike', 'attack', 'missile', 'drone', 'bomb', 'shell', 'shelling',
  'killed', 'wounded', 'injured', 'casualties', 'troops', 'forces',
  'frontline', 'front line', 'offensive', 'assault', 'artillery',
  'rocket', 'explosion', 'combat', 'advance', 'retreat', 'counterattack',
  'bombardment', 'barrage', 'captured', 'liberated', 'occupied'
];

const DIPLOMATIC = [
  'ceasefire', 'peace', 'talks', 'sanctions', 'summit', 'negotiat',
  'treaty', 'minister', 'president', 'nato', 'aid package', 'diplomat',
  'envoy', 'agreement', 'government', 'white house', 'zelensky', 'trump',
  'putin', 'kremlin', 'intelligence', 'pentagon', 'ambassador', 'allies',
  'european union', 'parliament', 'election', 'weapons deliveries'
];

const HUMANITARIAN = [
  'evacuate', 'evacuation', 'refugee', 'civilian', 'humanitarian',
  'hospital', 'children', 'displaced', 'shelter', 'blackout',
  'power outage', 'prisoner', 'humanitarian aid'
];

const WHOLE_WORD = new Set(['war', 'nato']);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeMatchers(list) {
  return list.map(k => new RegExp(
    WHOLE_WORD.has(k) ? `\\b${escapeRegex(k)}\\b` : `\\b${escapeRegex(k)}`,
    'i'
  ));
}

const MILITARY_RX = makeMatchers(MILITARY);
const DIPLOMATIC_RX = makeMatchers(DIPLOMATIC);
const HUMANITARIAN_RX = makeMatchers(HUMANITARIAN);
const ALL_RX = makeMatchers([...MILITARY, ...DIPLOMATIC, ...HUMANITARIAN, 'war', 'invasion', 'military']);
const UKRAINE_RX = /\b(ukrain|russia|kyiv|kiev|kremlin|zelensk|putin|donbas|crimea|moscow)/i;

function classifyArticle(title, description) {
  const score = (matchers) =>
    matchers.filter(rx => rx.test(title)).length * 3 +
    matchers.filter(rx => rx.test(description)).length;

  const mil = score(MILITARY_RX);
  const dip = score(DIPLOMATIC_RX);
  const hum = score(HUMANITARIAN_RX);

  if (mil === 0 && dip === 0 && hum === 0) return 'military';
  if (mil > dip && mil > hum) return 'military';
  if (dip >= hum) return 'diplomatic';
  return 'humanitarian';
}

function toISO(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d)) return null;
  if (d.getTime() > Date.now() + 60 * 60 * 1000) return null;
  return d.toISOString();
}

const FEEDS = [
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/ukraine/rss' },
  { name: 'Kyiv Post', url: 'https://www.kyivpost.com/feed' },
  { name: 'RFE/RL', url: 'https://www.rferl.org/api/zviipl-vomx-tpeugmm' },
  { name: 'DW', url: 'https://rss.dw.com/rdf/rss-en-world' },
  { name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/world.xml' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'NPR', url: 'https://feeds.npr.org/1004/rss.xml' },
  { name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/world' },
  { name: 'ABC News (Australia)', url: 'https://www.abc.net.au/news/feed/45910/rss.xml' },
  { name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Europe.xml' },
  { name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' }
];

async function fetchNews() {
  const results = await Promise.all(FEEDS.map(async (feed) => {
    try {
      const parsed = await parser.parseURL(feed.url);
      console.log(`Feed OK (${parsed.items.length} items): ${feed.name}`);
      return parsed.items.slice(0, 40).map(item => ({ item, source: feed.name }));
    } catch (e) {
      console.log(`Feed failed: ${feed.name} (${feed.url}) - ${e.message}`);
      return [];
    }
  }));

  const articles = [];
  const seenTitles = new Set();
  const seenLinks = new Set();

  for (const { item, source } of results.flat()) {
    const title = (item.title || '').trim();
    const description = (item.contentSnippet || item.content || '').trim();
    const link = (item.link || '').trim();
    if (!title || !/^https?:\/\//i.test(link)) continue;

    const titleKey = title.toLowerCase();
    if (seenTitles.has(titleKey) || seenLinks.has(link)) continue;

    const combined = title + ' ' + description;
    if (!ALL_RX.some(rx => rx.test(combined))) continue;

    const place = findPlace(title) || findPlace(description);
    const hasUkraineTerm = UKRAINE_RX.test(combined);
    if (place) {
      if (!place.curated && !hasUkraineTerm) continue;
    } else if (!hasUkraineTerm) {
      continue;
    }

    seenTitles.add(titleKey);
    seenLinks.add(link);

    articles.push({
      title,
      link,
      source,
      description: description.slice(0, 120),
      raw_text: (title + '\n' + description).slice(0, 2000),
      city: place ? place.name : null,
      lat: place ? place.lat : null,
      lng: place ? place.lng : null,
      published_at: toISO(item.isoDate || item.pubDate),
      type: classifyArticle(title, description)
    });
  }

  return articles;
}

const rematchUnpinned = db.transaction(() => {
  let updated = 0;
  for (const row of selectUnpinned.all()) {
    const description = (row.raw_text || '').split('\n').slice(1).join('\n');
    const place = findPlace(row.title) || findPlace(description);
    if (place) {
      setPlace.run(place.name, place.lat, place.lng, row.id);
      updated++;
    }
  }
  return updated;
});

let refreshing = null;

function refreshArchive() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      console.log('Fetching fresh news...');
      const found = await fetchNews();
      const now = new Date().toISOString();
      const rows = found.map(a => ({
        link: a.link,
        title: a.title,
        description: a.description,
        raw_text: a.raw_text,
        city: a.city,
        lat: a.lat,
        lng: a.lng,
        type: a.type,
        source: a.source,
        published_at: a.published_at,
        first_seen_at: now,
        sort_date: a.published_at || now
      }));
      const added = insertMany(rows);
      const rematched = rematchUnpinned();
      const total = countArticles.get().n;
      const pinned = countPinned.get().n;
      console.log(`Archive: ${found.length} candidates, ${added} new, ${total} total, ${pinned} pinned`);
      if (rematched) {
        console.log(`Rematched ${rematched} previously unpinned articles`);
      }

      const tally = {};
      found.forEach(a => {
        if (a.city) tally[a.city] = (tally[a.city] || 0) + 1;
      });
      const top = Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([city, n]) => `${city} ${n}`)
        .join(', ');
      if (top) console.log('Top places this fetch:', top);
    } catch (err) {
      console.error('Archive refresh failed:', err.message);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const VALID_TYPES = ['military', 'diplomatic', 'humanitarian'];

app.get('/api/news', async (req, res) => {
  try {
    if (countArticles.get().n === 0 && refreshing) {
      await refreshing;
    }

    const { city, type, before, beforeId, unlocated } = req.query;
    const where = [unlocated ? 'city IS NULL' : 'city IS NOT NULL'];
    const params = [];
    let limit;

    if (city) {
      where.push('city = ?');
      params.push(String(city));
    }
    if (type && VALID_TYPES.includes(type)) {
      where.push('type = ?');
      params.push(type);
    }

    if (before) {
      const lastId = parseInt(beforeId, 10);
      if (Number.isInteger(lastId)) {
        where.push('(sort_date < ? OR (sort_date = ? AND id < ?))');
        params.push(String(before), String(before), lastId);
      } else {
        where.push('sort_date < ?');
        params.push(String(before));
      }
      limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    } else {
      const days = Math.min(parseInt(req.query.days, 10) || 7, 365);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      where.push('sort_date >= ?');
      params.push(cutoff);
      limit = Math.min(parseInt(req.query.limit, 10) || 1000, 1000);
    }

    const sql = `
      SELECT id, title, link, description, city, lat, lng, type, source, sort_date AS date
      FROM articles
      WHERE ${where.join(' AND ')}
      ORDER BY sort_date DESC, id DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params, limit);
    res.json(rows);
  } catch (err) {
    console.error('News query failed:', err.message);
    res.status(500).json({ error: 'Failed to load news' });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 7, 365);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN city IS NULL THEN 1 ELSE 0 END) AS unlocated
      FROM articles
      WHERE sort_date >= ?
    `).get(cutoff);
    const total = row.total || 0;
    const unlocated = row.unlocated || 0;
    res.json({ days, total, located: total - unlocated, unlocated });
  } catch (err) {
    console.error('Stats query failed:', err.message);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

loadPlaces();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  syncFrontline();
  refreshArchive();
  setInterval(refreshArchive, 60 * 60 * 1000);
  setInterval(syncFrontline, 6 * 60 * 60 * 1000);
});