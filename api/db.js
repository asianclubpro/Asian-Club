const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('DATABASE_URL not set — DB module will throw on use');
}

// Configure SSL for hosted Postgres (Supabase) when requested via env var or PGSSLMODE
const useSsl = (process.env.DATABASE_SSL === 'true') || (process.env.PGSSLMODE === 'require');
const pool = new Pool(useSsl ? { connectionString, ssl: { rejectUnauthorized: false } } : { connectionString });

async function init() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS movies (
        id TEXT PRIMARY KEY,
        title TEXT,
        quality TEXT,
        language TEXT,
        codec TEXT,
        hash TEXT,
        status TEXT,
        poster TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS series (
        id TEXT PRIMARY KEY,
        title TEXT,
        poster TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        season INT,
        episode INT,
        title TEXT,
        hash TEXT,
        quality TEXT,
        language TEXT,
        codec TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_movies_hash ON movies(hash);
    `);
    // Ensure episodes has poster column for backward compatibility
    await client.query("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS poster TEXT");
    await client.query("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS quality TEXT");
    await client.query("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS language TEXT");
    await client.query("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS codec TEXT");
  } finally {
    client.release();
  }
}

// Helper: get columns for a table (not cached to keep simplicity)
async function getTableColumns(table) {
  const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [table]);
  return res.rows.map(r => r.column_name);
}
async function listMovies(limit = 50, offset = 0) {
  // Return movies ordered by creation date (most recent first)
  const res = await pool.query('SELECT id,title,poster,quality,language,codec,hash,status,created_at FROM movies ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
  return res.rows;
}

async function getMovieById(id) {
  const res = await pool.query('SELECT * FROM movies WHERE id=$1', [id]);
  return res.rows[0] || null;
}

async function createMovie(m) {
  const q = `INSERT INTO movies (id,title,quality,language,codec,hash,status,poster) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
  await pool.query(q, [m.id, m.title || null, m.quality || null, m.language || null, m.codec || null, m.hash || null, m.status || null, m.poster || null]);
}

async function updateMovie(id, m) {
  const q = `UPDATE movies SET title=$1, quality=$2, language=$3, codec=$4, hash=$5, status=$6, poster=$7, updated_at=now() WHERE id=$8`;
  await pool.query(q, [m.title || null, m.quality || null, m.language || null, m.codec || null, m.hash || null, m.status || null, m.poster || null, id]);
}

async function deleteMovie(id) {
  await pool.query('DELETE FROM movies WHERE id=$1', [id]);
}

// Series CRUD
async function listSeries(limit = 50, offset = 0) {
  const res = await pool.query('SELECT id,title,poster FROM series ORDER BY title LIMIT $1 OFFSET $2', [limit, offset]);
  return res.rows;
}

async function getSeriesById(id) {
  const res = await pool.query('SELECT * FROM series WHERE id=$1', [id]);
  return res.rows[0] || null;
}

async function createSeries(s) {
  await pool.query('INSERT INTO series (id,title,poster) VALUES ($1,$2,$3)', [s.id, s.title || null, s.poster || null]);
}

async function updateSeries(id, s) {
  await pool.query('UPDATE series SET title=$1, poster=$2, updated_at=now() WHERE id=$3', [s.title || null, s.poster || null, id]);
}

async function deleteSeries(id) {
  await pool.query('DELETE FROM series WHERE id=$1', [id]);
}

// Episodes CRUD
async function listEpisodes(limit = 200, offset = 0) {
  const cols = await getTableColumns('episodes');
  const wanted = ['id','season','episode','title','poster','hash','quality','language','codec','created_at','updated_at'];
  const selected = wanted.filter(c => cols.includes(c));
  const selectClause = selected.length ? selected.join(',') : '*';
  const res = await pool.query(`SELECT ${selectClause} FROM episodes ORDER BY id LIMIT $1 OFFSET $2`, [limit, offset]);
  return res.rows;
}

async function getEpisodeById(id) {
  const res = await pool.query('SELECT * FROM episodes WHERE id=$1', [id]);
  return res.rows[0] || null;
}

async function createEpisode(e) {
  if (!e || !e.id) throw new Error('createEpisode requires an object with at least `id`');
  const cols = await getTableColumns('episodes');
  const allowed = ['id','season','episode','title','hash','poster','quality','language','codec'];
  const toInsert = allowed.filter(c => cols.includes(c));
  if (toInsert.length === 0) throw new Error('no writable columns found for episodes');
  const values = toInsert.map((c) => (e[c] !== undefined ? e[c] : null));
  const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
  const q = `INSERT INTO episodes (${toInsert.join(',')}) VALUES (${placeholders})`;
  await pool.query(q, values);
}

async function updateEpisode(id, e) {
  if (!id) throw new Error('updateEpisode requires id');
  const cols = await getTableColumns('episodes');
  const allowed = ['id','season','episode','title','hash','poster','quality','language','codec'];
  const toUpdate = allowed.filter(c => cols.includes(c));
  if (toUpdate.length === 0) {
    // Nothing to update besides timestamps — try updating updated_at if exists
    if (cols.includes('updated_at')) {
      await pool.query('UPDATE episodes SET updated_at=now() WHERE id=$1', [id]);
      return;
    }
    return;
  }
  const sets = toUpdate.map((c, i) => `${c}=$${i + 1}`);
  let query = `UPDATE episodes SET ${sets.join(', ')}`;
  const values = toUpdate.map((c) => (e[c] !== undefined ? e[c] : null));
  if (cols.includes('updated_at')) {
    query += `${sets.length ? ', ' : ''}updated_at=now()`;
  }
  const idx = values.length + 1;
  query += ` WHERE id=$${idx}`;
  values.push(id);
  await pool.query(query, values);
}

async function deleteEpisode(id) {
  await pool.query('DELETE FROM episodes WHERE id=$1', [id]);
}

module.exports = {
  pool,
  init,
  // movies
  listMovies,
  getMovieById,
  createMovie,
  updateMovie,
  deleteMovie,
  // series
  listSeries,
  getSeriesById,
  createSeries,
  updateSeries,
  deleteSeries,
  // episodes
  listEpisodes,
  getEpisodeById,
  createEpisode,
  updateEpisode,
  deleteEpisode,
};
