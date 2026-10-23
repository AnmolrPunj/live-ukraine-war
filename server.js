require('dotenv').config();
const express = require('express');
const axios = require('axios');
const RSSParser = require('rss-parser');
const parser = new RSSParser({ timeout: 10000 });

const app = express();
const PORT = 3000;

app.use(express.static('public'));

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

let frontlineCache = null;
let frontlineFetched = null;

app.get('/api/frontline', async (req, res) => {
  try {
    const sixHours = 6 * 60 * 60 * 1000;
    if (!frontlineCache || Date.now() - frontlineFetched > sixHours) {
      console.log('Fetching fresh frontline data...');
      const apiResponse = await axios.get(
        'https://api.github.com/repos/cyterat/deepstate-map-data/contents/data',
        { headers: { 'Accept': 'application/vnd.github.v3+json' } }
      );
      const files = apiResponse.data;
      const latestFile = files[files.length - 1];
      console.log('Latest frontline file:', latestFile.name);
      const response = await axios.get(latestFile.download_url);
      frontlineCache = response.data;
      frontlineFetched = Date.now();
    }
    res.json(frontlineCache);
  } catch (err) {
    console.error('Frontline fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch frontline data' });
  }
});

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

const UKRAINE_CITIES = Object.keys(CITY_COORDS);

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

const ALL_KEYWORDS = [
  ...MILITARY, ...DIPLOMATIC, ...HUMANITARIAN, 'war', 'invasion', 'military'
];

function classifyArticle(title, description) {
  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();
  const score = (list) =>
    list.filter(k => titleLower.includes(k)).length * 3 +
    list.filter(k => descLower.includes(k)).length;

  const mil = score(MILITARY);
  const dip = score(DIPLOMATIC);
  const hum = score(HUMANITARIAN);

  if (mil === 0 && dip === 0 && hum === 0) return 'military';
  if (mil > dip && mil > hum) return 'military';
  if (dip >= hum) return 'diplomatic';
  return 'humanitarian';
}

const FEEDS = [
  'https://feeds.bbci.co.uk/news/world/europe/rss.xml',
  'https://www.theguardian.com/world/ukraine/rss',
  'https://www.kyivpost.com/feed',
  'https://www.rferl.org/api/aujqgq_l-vomx-tpeg_pgqy',
  'https://rss.dw.com/rdf/rss-en-world',
  'https://feeds.skynews.com/feeds/rss/world.xml',
  'https://www.aljazeera.com/xml/rss/all.xml'
];

let newsCache = null;
let newsFetched = null;
let warming = false;

async function fetchNews() {
  const results = await Promise.all(FEEDS.map(async (feedUrl) => {
    try {
      const feed = await parser.parseURL(feedUrl);
      console.log(`Feed OK (${feed.items.length} items): ${feedUrl}`);
      return feed.items.slice(0, 40);
    } catch (e) {
      console.log('Feed failed:', feedUrl, '-', e.message);
      return [];
    }
  }));

  const articles = [];
  const seenTitles = new Set();
  const seenLinks = new Set();

  for (const item of results.flat()) {
    const title = (item.title || '').trim();
    const description = (item.contentSnippet || item.content || '').trim();
    const link = item.link || '';
    if (!title || !link) continue;
    if (seenTitles.has(title.toLowerCase()) || seenLinks.has(link)) continue;

    const titleLower = title.toLowerCase();
    const descLower = description.toLowerCase();
    const city =
      UKRAINE_CITIES.find(c => titleLower.includes(c.toLowerCase())) ||
      UKRAINE_CITIES.find(c => descLower.includes(c.toLowerCase()));
    if (!city) continue;

    const combined = titleLower + ' ' + descLower;
    if (!ALL_KEYWORDS.some(k => combined.includes(k))) continue;

    seenTitles.add(titleLower);
    seenLinks.add(link);

    const [lat, lng] = CITY_COORDS[city];
    articles.push({
      title,
      link,
      description: description.slice(0, 120),
      city,
      lat,
      lng,
      date: item.isoDate || item.pubDate || null,
      type: classifyArticle(title, description)
    });
  }

  articles.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  console.log(`Found ${articles.length} geolocated articles`);
  return articles;
}

async function warmCache() {
  if (warming) return;
  warming = true;
  try {
    console.log('Fetching fresh news...');
    newsCache = await fetchNews();
    newsFetched = Date.now();
  } catch (err) {
    console.error('News fetch failed:', err.message);
  } finally {
    warming = false;
  }
}

app.get('/api/news', async (req, res) => {
  const oneHour = 60 * 60 * 1000;
  if (!newsCache || Date.now() - newsFetched > oneHour) {
    await warmCache();
  }
  res.json(newsCache || []);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  warmCache();
});