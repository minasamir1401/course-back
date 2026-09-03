const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    database: 'postgres',
  });

  await client.connect();
  await client.query("ALTER USER postgres WITH PASSWORD '1111'");
  await client.end();
  console.log('postgres password reset to 1111');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
