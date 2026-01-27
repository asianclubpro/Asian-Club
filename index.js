require('dotenv').config();
const express = require("express");
const path = require("path");
const addon = require("./api/addon");




const app = express();

// Servir archivos estáticos (index.html, admin/, public/, icon/banner)
app.use(express.static(path.join(__dirname)));

// Montar el addon (maneja rutas tipo /realdebrid=TOKEN/...)
app.use("/", addon);

// Admin routes (revalidation)
app.use('/admin', require('./api/admin'));

// Ensure DB schema at startup (creates missing columns/tables if needed)
const db = require('./api/db');

(async function start() {
	try {
		await db.init();
		const PORT = process.env.PORT || 3000;
		app.listen(PORT, () => console.log(`Asian Club local → http://localhost:${PORT}`));
	} catch (err) {
		console.error('Failed to initialize DB at startup:', err && (err.stack || err));
		// Still start the server so admin can call /admin/db/init if needed
		const PORT = process.env.PORT || 3000;
		app.listen(PORT, () => console.log(`Asian Club local (db-init-failed) → http://localhost:${PORT}`));
	}
})();
