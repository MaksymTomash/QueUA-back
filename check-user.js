const { Client } = require('pg');
const bcrypt = require('bcrypt');
const DB = { host: '127.0.0.1', port: 5433, user: 'queua', password: 'queua_secret', database: 'queua_db' };

async function main() {
  const c = new Client(DB);
  await c.connect();

  const r = await c.query("SELECT id, email, password_hash FROM users WHERE email = 'citizen1@test.ua'");
  const user = r.rows[0];
  console.log('Found user:', user ? user.email : 'NOT FOUND');
  if (user) {
    console.log('password_hash:', user.password_hash);
    const ok = await bcrypt.compare('Test1234!', user.password_hash);
    console.log('bcrypt.compare result:', ok);
  }

  await c.end();
}
main().catch(e => console.error(e.message));
