require('dotenv').config();
const axios = require('axios');
const { Redis } = require('@upstash/redis');

const TORBOX_TOKEN = '9f21afe0-5dbd-4f64-87c2-570c1448e9c8';
const MOVIE_ID = 'tt35276942';
const STREAM_URL = `http://localhost:3000/torbox=${TORBOX_TOKEN}/stream/movie/${MOVIE_ID}.json`;
const REVALIDATE_URL = 'http://localhost:3000/admin/revalidate';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';

(async () => {
  try {
    console.log('1) Requesting stream to populate cache...');
    const r1 = await axios.get(STREAM_URL, { timeout: 20000 });
    console.log('  Stream status:', r1.status);
    console.log('  Streams count:', r1.data.streams.length);

    console.log('\n2) Testing cache backend via Upstash client (GET key using versioned key)');
    const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

    const versionKey = `version:movie:${MOVIE_ID}`;
    const ver = await redis.get(versionKey) || '1';
    const streamKey = `stream:v:${ver}:service:torbox:token:${TORBOX_TOKEN}:type:movie:id:${MOVIE_ID}`;

    const cached = await redis.get(streamKey);
    console.log('  Using version', ver, '-> stream key exists:', cached ? '(exists)' : '(missing)');

    console.log('\n3) Calling /admin/cache/test to confirm backend');
    const ct = await axios.get('http://localhost:3000/admin/cache/test', { headers: { 'x-admin-token': ADMIN_TOKEN }, timeout: 10000 });
    console.log('  admin/cache/test ->', ct.status, ct.data);

    console.log('\n3.5) Fetch cache status (/admin/cache/status)');
    const cs = await axios.get('http://localhost:3000/admin/cache/status', { headers: { 'x-admin-token': ADMIN_TOKEN }, timeout: 10000 });
    console.log('  admin/cache/status ->', cs.status, JSON.stringify(cs.data));

    console.log('\n4) Invalidate movie via /admin/revalidate { movie }');
    const rv = await axios.post(REVALIDATE_URL, { movie: MOVIE_ID }, { headers: { 'x-admin-token': ADMIN_TOKEN }, timeout: 10000 });
    console.log('  revalidate response:', rv.status, rv.data);

    console.log('\n5) Check version changed and repopulate new key');
    const newVer = await redis.get(versionKey) || '1';
    console.log('  old ver:', ver, 'new ver:', newVer);

    // Request stream again to populate under the new version
    console.log('\n6) Requesting stream again so instance will write using the new version');
    const r2 = await axios.get(STREAM_URL, { timeout: 20000 });
    console.log('  Stream status (2):', r2.status, 'streams:', r2.data.streams.length);

    const streamKeyNew = `stream:v:${newVer}:service:torbox:token:${TORBOX_TOKEN}:type:movie:id:${MOVIE_ID}`;
    const newKeyPresent = await redis.get(streamKeyNew);
    console.log('  new stream key present:', newKeyPresent ? '(exists)' : '(missing)');

    console.log('\nE2E test completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('E2E test error:', JSON.stringify({ message: err?.message, code: err?.code, stack: err?.stack, responseStatus: err?.response?.status, responseData: err?.response?.data }, null, 2));
    process.exit(1);
  }
})();