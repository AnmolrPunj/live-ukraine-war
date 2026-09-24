require('dotenv').config();
const express = require('express');
const axios = require('axios');

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});