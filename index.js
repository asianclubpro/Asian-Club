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
		server = app.listen(PORT, () => console.log(`Asian Club local  http://localhost:${PORT}`));
	} catch (err) {
		console.error('Failed to initialize DB at startup:', err && (err.stack || err));
		// Still start the server so admin can call /admin/db/init if needed
		const PORT = process.env.PORT || 3000;
		server = app.listen(PORT, () => console.log(`Asian Club local (db-init-failed)  http://localhost:${PORT}`));
	}
})();

// Global error handlers to improve observability in production
process.on('uncaughtException', (err) => {
	console.error('uncaughtException:', err && (err.stack || err));
	// Allow logs to flush then exit
	try { server && server.close(); } catch (e) {}
	process.exit(1);
});

process.on('unhandledRejection', (reason) => {
	console.error('unhandledRejection:', reason && (reason.stack || reason));
});

// Graceful shutdown on SIGTERM/SIGINT
process.on('SIGTERM', () => {
	console.log('SIGTERM received, shutting down gracefully');
	try {
		if (server) {
			server.close(() => {
				console.log('HTTP server closed');
				process.exit(0);
			});
			// force exit if not closed after timeout
			setTimeout(() => process.exit(1), 10000).unref();
		} else {
			process.exit(0);
		}
	} catch (e) { console.error('Error during shutdown', e && (e.stack || e)); process.exit(1); }
});

process.on('SIGINT', () => { console.log('SIGINT received'); process.emit('SIGTERM'); });
