const torbox = require('../api/services/torbox');

(async () => {
  const KEY = '9f21afe0-5dbd-4f64-87c2-570c1448e9c8';
  const HASH = '1d4d6f55c06bb36dadd3653533fc81c3ad43ebde';

  console.log('Testing torbox.getStream for hash:', HASH);
  try {
    const streams = await torbox.getStream(KEY, HASH, {});
    console.log('Streams:', JSON.stringify(streams, null, 2));
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
})();