const db = require('./db');

(async () => {
  try {
    const [rows] = await db.query('SELECT 1 AS ok');
    console.log('✅ Connexion OK:', rows);

    // verifier la DB et les tables
    const [dbName] = await db.query('SELECT DATABASE() AS db');
    console.log('DB active:', dbName);

    const [tables] = await db.query('SHOW TABLES');
    console.log('Tables:', tables);
  } catch (err) {
    console.error('Connexion echoue:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    // fermer le pool
    db.end();
  }
})();
