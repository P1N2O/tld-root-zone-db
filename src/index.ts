import * as cheerio from "cheerio";
import { stringify } from "csv-stringify/sync";
import fs from "fs";
import https from "https";
import fetch from "node-fetch";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

/**
 * URL of the IANA Root Zone Database
 * This page contains all active top-level domains (TLDs)
 */
const URL = "https://www.iana.org/domains/root/db";

/**
 * Resolve paths relative to the current file
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Directory and file paths for storing output
const DATA_DIR = path.join(__dirname, "..", "data");
const CSV_FILE = path.join(DATA_DIR, "tlds.csv");
const JSON_FILE = path.join(DATA_DIR, "tlds.json");

/**
 * Force IPv4 in environments (e.g. CI/CD, GitHub Actions)
 * where IPv6 can cause timeouts when fetching from IANA
 */
const httpsAgent = new https.Agent({ family: 4 });

/**
 * Row structure for a TLD entry
 */
interface TLDRow {
  domain: string;
  type: string;
  tldManager: string;
}

/**
 * Fetch TLDs from IANA and parse the HTML into structured data
 */
async function fetchTlds(): Promise<TLDRow[]> {
  // Fetch the IANA root zone DB page
  const response = await fetch(URL, { agent: httpsAgent });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${URL}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Load HTML into Cheerio for parsing (like jQuery on the server)
  const $ = cheerio.load(html);
  const rows: TLDRow[] = [];

  // Select each row in the TLD table
  $("table.iana-table tbody tr").each((_, el) => {
    // Extract text from all <td> cells in the row
    const cols = $(el).find("td").map((_, td) => $(td).text().trim()).get();

    // If the row has exactly 3 columns, it’s a valid TLD row
    if (cols.length === 3) {
      rows.push({
        domain: cols[0],        // e.g. ".com"
        type: cols[1],          // e.g. "generic"
        tldManager: cols[2],    // e.g. "Verisign Global Registry Services"
      });
    }
  });

  return rows;
}

/**
 * Save TLD data as a CSV file
 */
async function saveCsv(rows: TLDRow[]) {
  const header = [["Domain", "Type", "TLD Manager"]];
  const records = rows.map(r => [r.domain, r.type, r.tldManager]);

  // Convert rows to CSV format
  const csv = stringify([...header, ...records]);

  // Write CSV file to disk
  fs.writeFileSync(CSV_FILE, csv, "utf-8");
}

/**
 * Save TLD data as a JSON file
 */
async function saveJson(rows: TLDRow[]) {
  fs.writeFileSync(JSON_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

/**
 * Main function to orchestrate the update
 */
async function main() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log("Fetching TLD data from IANA...");
  const rows = await fetchTlds();

  console.log(`Fetched ${rows.length} TLDs. Saving...`);
  await saveCsv(rows);
  await saveJson(rows);

  console.log("✅ Data updated!");
}

// Run the script
main().catch(err => {
  console.error(err);
  process.exit(1);
});
