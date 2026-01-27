const axios = require('axios');

const STREAM_URL = 'http://localhost:3000/torbox=9f21afe0-5dbd-4f64-87c2-570c1448e9c8/stream/movie/ttTEST001.json';
const REVALIDATE_URL = 'http://localhost:3000/admin/revalidate';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';

(async () => {
  try {
    console.log('1) First request (populate cache)');
    let t0 = Date.now();
    const r1 = await axios.get(STREAM_URL);
    console.log('Status:', r1.status, 'Time:', Date.now() - t0, 'ms');
    console.log('Body:', JSON.stringify(r1.data, null, 2));

    console.log('\n2) Second request (should hit cache)');
    t0 = Date.now();
    const r2 = await axios.get(STREAM_URL);
    console.log('Status:', r2.status, 'Time:', Date.now() - t0, 'ms');
    console.log('Body length streams:', r2.data.streams.length);

    console.log('\n3) Revalidate cache via admin');
    const re = await axios.post(REVALIDATE_URL, { key: `stream:service:torbox:token:9f21afe0-5dbd-4f64-87c2-570c1448e9c8:type:movie:id:ttTEST001` }, { headers: { 'x-admin-token': ADMIN_TOKEN } });
    console.log('Revalidate response:', re.status, re.data);

    console.log('\n4) Third request after revalidate (should repopulate)');
    t0 = Date.now();
    const r3 = await axios.get(STREAM_URL);
    console.log('Status:', r3.status, 'Time:', Date.now() - t0, 'ms');
    console.log('Body:', JSON.stringify(r3.data, null, 2));
  } catch (err) {
    console.error('Error:', err.response?.status, err.response?.data || err.message);
  }
})();
