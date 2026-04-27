import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 1000;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
const schema = await readFile(schemaPath, "utf8");
const pool = new Pool({ connectionString: DATABASE_URL });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    await pool.query(schema);
    await pool.end();
    console.log("Database migration complete.");
    process.exit(0);
  } catch (error) {
    if (attempt === MAX_ATTEMPTS) {
      await pool.end();
      console.error("Database migration failed.");
      console.error(error);
      process.exit(1);
    }

    console.log(`Database not ready, retrying (${attempt}/${MAX_ATTEMPTS})...`);
    await delay(RETRY_DELAY_MS);
  }
}
