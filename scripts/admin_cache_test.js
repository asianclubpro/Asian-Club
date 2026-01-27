const axios = require('axios');
(async () => {
  try {
    const res = await axios.get('http://localhost:3000/admin/cache/test', { headers: { 'x-admin-token': process.env.ADMIN_TOKEN || 'changeme' }, timeout: 10000 });
    console.log('Status:', res.status);
    console.log('Body:', res.data);
  } catch (err) {
    console.error('Error:', err.response?.status, err.response?.data || err.message);
  }
})();