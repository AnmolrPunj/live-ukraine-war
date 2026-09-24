require('dotenv').config();
const express = require('express');
const axios = require('axios');
const RSSParser = require('rss-parser');
const parser = new RSSParser();

const app = express();
const PORT = 3000;

app.use(express.static('public'));

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

let frontlineCache = null;
let lastFetched = null;

app.get('/api/frontline', async (req, res) => {
  try {
    const sixHours = 6 * 60 * 60 * 1000;
    if (!frontlineCache || Date.now() - lastFetched > sixHours) {
      console.log('Fetching fresh frontline data...');
      const apiResponse = await axios.get(
        'https://api.github.com/repos/cyterat/deepstate-map-data/contents/data',
        { headers: { 'Accept': 'application/vnd.github.v3+json' } }
      );
      const files = apiResponse.data;
      const latestFile = files[files.length - 1];
      console.log('Latest file found:', latestFile.name);
      const response = await axios.get(latestFile.download_url);
      frontlineCache = response.data;
      lastFetched = Date.now();
    }
    res.json(frontlineCache);
  } catch (err) {
    console.error('Frontline fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch frontline data' });
  }
});

const UKRAINE_CITIES = [
  'Kyiv', 'Kiev', 'Kharkiv', 'Mariupol', 'Zaporizhzhia', 'Zaporizhzhya',
  'Kherson', 'Odesa', 'Odessa', 'Donetsk', 'Luhansk', 'Dnipro',
  'Sumy', 'Mykolaiv', 'Kramatorsk', 'Bakhmut', 'Avdiivka',
  'Kursk', 'Sloviansk', 'Melitopol', 'Berdiansk', 'Chernihiv',
  'Poltava', 'Lviv', 'Zhytomyr', 'Vinnytsia', 'Severodonetsk',
  'Lysychansk', 'Toretsk', 'Pokrovsk', 'Nikopol', 'Lozova',
  'Oleshky', 'Izium', 'Izyum', 'Chasiv Yar', 'Vuhledar',
  'Marinka', 'Orikhiv', 'Robotyne', 'Enerhodar', 'Huliaipole',
  'Kupiansk', 'Lyman', 'Kreminna', 'Svatove', 'Sievierodonetsk',
  'Belgorod', 'Kharkiv region', 'Donetsk region', 'Zaporizhzhia region'
];

const WAR_KEYWORDS = [
  'strike', 'attack', 'missile', 'drone', 'bomb', 'shell', 'shelling',
  'killed', 'wounded', 'injured', 'casualties', 'troops', 'forces',
  'frontline', 'front line', 'offensive', 'assault', 'invasion',
  'artillery', 'rocket', 'explosion', 'military', 'combat', 'war',
  'evacuate', 'evacuation', 'occupation', 'occupied', 'liberated',
  'ceasefire', 'peace', 'sanctions', 'prisoner', 'captured',
  'advance', 'retreat', 'counterattack', 'bombardment', 'barrage'
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let newsCache = null;
let newsFetched = null;

async function geocodeCity(city) {
  try {
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/search?q=${city},Ukraine&format=json&limit=1`,
      { headers: { 'User-Agent': 'UkraineWarMap/1.0' } }
    );
    if (response.data.length > 0) {
      return {
        lat: parseFloat(response.data[0].lat),
        lng: parseFloat(response.data[0].lon)
      };
    }
  } catch(e) {}
  return null;
}

app.get('/api/news', async (req, res) => {
  try {
    const oneHour = 60 * 60 * 1000;
    if (!newsCache || Date.now() - newsFetched > oneHour) {
      console.log('Fetching fresh news...');

      const feeds = [
        'https://feeds.bbci.co.uk/news/world/europe/rss.xml',
        'https://rss.dw.com/rdf/rss-en-world',
        'https://www.theguardian.com/world/ukraine/rss',
        'https://feeds.skynews.com/feeds/rss/world.xml',
        'https://feeds.reuters.com/reuters/worldNews',
        'https://www.aljazeera.com/xml/rss/all.xml',
        'https://www.kyivpost.com/feed',
        'https://www.rferl.org/api/aujqgq_l-vomx-tpeg_pgqy'
      ];

      let articles = [];
      const geocodeCache = {};

      for (const feedUrl of feeds) {
        try {
          const feed = await parser.parseURL(feedUrl);
          for (const item of feed.items.slice(0, 30)) {
            const title = item.title || '';
            const description = item.contentSnippet || item.content || '';

            const matchedCity =
              UKRAINE_CITIES.find(city => title.toLowerCase().includes(city.toLowerCase())) ||
              UKRAINE_CITIES.find(city => description.toLowerCase().includes(city.toLowerCase()));

            const isWarRelated = WAR_KEYWORDS.some(keyword =>
              (title + ' ' + description).toLowerCase().includes(keyword.toLowerCase())
            );

            if (matchedCity && isWarRelated) {
              let coords = geocodeCache[matchedCity];
              if (!coords) {
                await sleep(1000);
                coords = await geocodeCity(matchedCity);
                if (coords) geocodeCache[matchedCity] = coords;
              }
              if (coords) {
                articles.push({
                  title,
                  link: item.link,
                  description: description.slice(0, 200),
                  city: matchedCity,
                  lat: coords.lat,
                  lng: coords.lng,
                  date: item.pubDate
                });
              }
            }
          }
        } catch(e) {
          console.log('Feed failed:', feedUrl, e.message);
        }
      }

      console.log(`Found ${articles.length} geolocated articles`);
      newsCache = articles;
      newsFetched = Date.now();
    }
    res.json(newsCache);
  } catch (err) {
    console.error('News fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});