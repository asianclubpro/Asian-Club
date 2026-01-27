const axios = require('axios');

(async () => {
  try {
    const url = 'http://localhost:3000/torbox=9f21afe0-5dbd-4f64-87c2-570c1448e9c8/stream/movie/ttTEST001.json';
    console.log('Requesting:', url);
    const res = await axios.get(url);
    console.log('Status:', res.status);
    console.log('Body:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('Error:', err.response?.status, err.response?.data || err.message);
  }
})();