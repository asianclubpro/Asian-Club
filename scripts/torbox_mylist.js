const axios = require('axios');
const TOKEN = '9f21afe0-5dbd-4f64-87c2-570c1448e9c8';
const HASH = '1d4d6f55c06bb36dadd3653533fc81c3ad43ebde';
const BASE = 'https://api.torbox.app/v1/api';

(async () => {
  try {
    console.log('Fetching mylist...');
    const res = await axios.get(`${BASE}/torrents/mylist`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    console.log('Status:', res.status);
    const data = res.data;
    if (data && data.success && data.data) {
      const list = data.data;
      console.log('Total items:', list.length);
      const found = list.find(t => (t.hash && t.hash.toLowerCase() === HASH) || (t.hash && t.hash.toUpperCase() === HASH.toUpperCase()));
      console.log('Found in mylist?', !!found);
      if (found) console.log('Found entry:', JSON.stringify(found, null, 2));
    } else {
      console.log('No data in mylist response:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('ERROR:', err.response?.status, err.response?.data || err.message);
  }
})();
