const axios = require('axios');
const TOKEN = '9f21afe0-5dbd-4f64-87c2-570c1448e9c8';
const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };

(async () => {
  try {
    console.log('GET /torrents');
    const r = await axios.get('https://api.torbox.app/torrents', auth);
    console.log('Status:', r.status);
    console.log('Type of data:', typeof r.data);
    console.log('Sample data keys:', Array.isArray(r.data) ? `array(${r.data.length})` : Object.keys(r.data).slice(0,10));
    const hash = '6A3087D07AE1E9CEF7F1E47F04A3F5DFDED2B727';
    const found = (r.data || []).find(t => t.hash && t.hash.toUpperCase() === hash);
    console.log('Found hash in list?', !!found);
    if (found) console.log('Found torrent:', found);
  } catch (err) {
    console.error('ERROR:', err.response?.status, err.response?.data || err.message);
  }
})();
