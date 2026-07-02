import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Manually parse .env file to avoid dependency on dotenv package
const envPath = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || !line.includes('=')) return;
    const parts = line.split('=');
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    env[key] = value;
  });
}

const { Client } = pg;

async function main() {
  const sqlFile = process.argv[2];
  if (!sqlFile) {
    console.error("Please specify a SQL file path.");
    process.exit(1);
  }

  const sqlPath = path.resolve(process.cwd(), sqlFile);
  if (!fs.existsSync(sqlPath)) {
    console.error(`File not found: ${sqlPath}`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  // Supabase connection pooler details (using aws-1 pooler)
  const dbPassword = env.SUPABASE_DB_PASSWORD;
  const projectRef = 'frluadnvvfvrqyiqislm';
  const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`;

  console.log(`Connecting to database pooler aws-1-ap-south-1.pooler.supabase.com ...`);
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected successfully. Running SQL script...");
    const res = await client.query(sqlContent);
    console.log("SQL executed successfully.");
    console.log(res);
  } catch (err) {
    console.error("Error executing SQL:", err);
  } finally {
    await client.end();
  }
}

main();
