const axios = require('axios');
(async () => {
  try {
    const key = 'stream:service:torbox:token:9f21afe0-5dbd-4f64-87c2-570c1448e9c8:type:movie:id:tt35276942';
    const url = 'http://localhost:3000/admin/revalidate';
    const res = await axios.post(url, { key }, { headers: { 'x-admin-token': process.env.ADMIN_TOKEN || 'changeme', 'Content-Type': 'application/json' }, timeout: 10000 });
    console.log('Revalidate status:', res.status);
    console.log('Revalidate body:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('Revalidate error:', err.response?.status, err.response?.data || err.message);
    process.exit(1);
  }
})();