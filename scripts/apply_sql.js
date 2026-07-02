import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from frontend/.env
dotenv.config({ path: path.join(__dirname, '../frontend/.env') });

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

  // Supabase connection details
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  const projectRef = 'frluadnvvfvrqyiqislm';
  const connectionString = `postgresql://postgres:${encodeURIComponent(dbPassword)}@db.${projectRef}.supabase.co:5432/postgres`;

  console.log(`Connecting to database db.${projectRef}.supabase.co ...`);
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
