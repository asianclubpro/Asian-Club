const axios = require('axios');
const TOKEN = '9f21afe0-5dbd-4f64-87c2-570c1448e9c8';
const BASE = 'https://api.torbox.app/v1/api';
const TORRENT_ID = 7240552;
const FILE_ID = 0;

(async () => {
  try {
    const url = `${BASE}/torrents/requestdl?token=${TOKEN}&torrent_id=${TORRENT_ID}&file_id=${FILE_ID}`;
    console.log('Requesting:', url);
    const res = await axios.get(url);
    console.log('Status:', res.status);
    console.log('Body:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('ERROR:', err.response?.status, err.response?.data || err.message);
  }
})();
