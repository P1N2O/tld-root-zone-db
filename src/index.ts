import * as cheerio from "cheerio";
import { stringify } from "csv-stringify/sync";
import fs from "fs";
import https from "https";
import fetch from "node-fetch";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

/**
 * URLs for data sources
 */
const IANA_ROOT_ZONE_URL = "https://www.iana.org/domains/root/db";
const IANA_RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const INTERNIC_ROOT_ZONE_URL = "https://www.internic.net/domain/root.zone";

/**
 * Resolve paths relative to the current file
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Directory and file paths for storing output
const DATA_DIR = path.join(__dirname, "..", "data");
// TLD File
const TLD_JSON_FILE = path.join(DATA_DIR, "tld.json");
const TLD_CSV_FILE = path.join(DATA_DIR, "tld.csv");
// RDAP FILE
const RDAP_JSON_FILE = path.join(DATA_DIR, "rdap.json");
const RDAP_CSV_FILE = path.join(DATA_DIR, "rdap.csv");
// DNSSEC File
const DNSSEC_JSON_FILE = path.join(DATA_DIR, "dnssec.json");
const DNSSEC_CSV_FILE = path.join(DATA_DIR, "dnssec.csv");
// Combined (TLD + RDAP + DNSSEC)
const COMBINED_JSON_FILE = path.join(DATA_DIR, "combined.json");
const COMBINED_CSV_FILE = path.join(DATA_DIR, "combined.csv");

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
 * Structure for IANA RDAP bootstrap data
 */
interface IanaRdapBootstrap {
  description: string;
  publication: string;
  services: any[][];
  version?: string;
}

/**
 * Structure for DNSSEC data
 */
interface DNSSECData {
  domain: string;
  dnssec: boolean;
}

/**
 * Fetch TLDs from IANA and parse the HTML into structured data
 */
async function fetchTlds(): Promise<TLDRow[]> {
  // Fetch the IANA root zone DB page
  const response = await fetch(IANA_ROOT_ZONE_URL, { agent: httpsAgent });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${IANA_ROOT_ZONE_URL}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Load HTML into Cheerio for parsing (like jQuery on the server)
  const $ = cheerio.load(html);
  const rows: TLDRow[] = [];

  // Select each row in the TLD table
  $("table.iana-table tbody tr").each((_, el) => {
    // Extract text from all <td> cells in the row
    const cols = $(el).find("td").map((_, td) => $(td).text().trim()).get();

    // If the row has exactly 3 columns, it's a valid TLD row
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
 * Fetch RDAP bootstrap data from IANA and extract only the services array
 */
async function fetchRdapBootstrap(): Promise<any[][]> {
  const response = await fetch(IANA_RDAP_BOOTSTRAP_URL, { agent: httpsAgent });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${IANA_RDAP_BOOTSTRAP_URL}: ${response.status} ${response.statusText}`);
  }

  const data: IanaRdapBootstrap = await response.json() as IanaRdapBootstrap;
  
  // Return only the services array
  return data.services;
}

/**
 * Fetch and parse DNSSEC data from InterNIC root.zone file
 * Returns a simple map of domain -> boolean (has DNSSEC or not)
 */
async function fetchDnssecData(): Promise<Map<string, boolean>> {
  const response = await fetch(INTERNIC_ROOT_ZONE_URL, { agent: httpsAgent });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${INTERNIC_ROOT_ZONE_URL}: ${response.status} ${response.statusText}`);
  }

  const zoneData = await response.text();
  const lines = zoneData.split('\n');
  const dnssecMap = new Map<string, boolean>();

  for (const line of lines) {
    if (!line.trim() || line.startsWith(';')) continue;

    const parts = line.split(/\s+/).filter(part => part !== '');
    if (parts.length < 4) continue;

    const domain = parts[0].toLowerCase();
    const type = parts[3];

    // Look for DS records (DNSSEC)
    if (type === 'DS' && domain.endsWith('.')) {
      const tld = domain.slice(0, -1); // Remove trailing dot
      dnssecMap.set(tld, true);
    }
  }

  return dnssecMap;
}

/**
 * Merge TLD data with RDAP URLs and DNSSEC data
 */
function mergeTldWithRdapAndDnssec(
  tldRows: TLDRow[], 
  rdapServices: any[][], 
  dnssecMap: Map<string, boolean>
): any[] {
  // Create a map of TLD to RDAP URLs (remove the dot from TLD for matching)
  const rdapMap = new Map<string, string[]>();
  
  rdapServices.forEach(([tlds, urls]) => {
    tlds.forEach((tld: string) => {
      // Store the URLs for this TLD
      rdapMap.set(tld.toLowerCase(), urls);
    });
  });

  // Merge the data
  return tldRows.map(tld => {
    const tldWithoutDot = tld.domain.replace(/^\./, '').toLowerCase(); // Remove leading dot and normalize
    const rdapUrls = rdapMap.get(tldWithoutDot) || [];
    const hasDnssec = dnssecMap.get(tldWithoutDot) || false;
    
    return {
      ...tld,
      rdap: rdapUrls,
      dnssec: hasDnssec
    };
  });
}

/**
 * Convert DNSSEC map to array for CSV/JSON export
 */
function dnssecMapToArray(dnssecMap: Map<string, boolean>): DNSSECData[] {
  return Array.from(dnssecMap.entries()).map(([domain, dnssec]) => ({
    domain,
    dnssec
  }));
}

/**
 * Convert RDAP services array to CSV-friendly format
 */
function transformRdapServicesForCsv(services: any[][]): any[] {
  return services.map((service) => {
    const [tldsArray, urlsArray] = service;
    return {
      tlds: tldsArray,
      urls: urlsArray
    };
  });
}

/**
 * Save TLD data as a CSV file
 */
async function saveTldCsv(rows: TLDRow[]) {
  const header = [["Domain", "Type", "TLD Manager"]];
  const records = rows.map(r => [r.domain, r.type, r.tldManager]);

  // Convert rows to CSV format
  const csv = stringify([...header, ...records]);

  // Write CSV file to disk
  fs.writeFileSync(TLD_CSV_FILE, csv, "utf-8");
}

/**
 * Save TLD data as a JSON file
 */
async function saveTldJson(rows: TLDRow[]) {
  fs.writeFileSync(TLD_JSON_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

/**
 * Save RDAP bootstrap services as a CSV file
 */
async function saveRDAPCsv(services: any[][]) {
  const transformed = transformRdapServicesForCsv(services);
  
  const header = [["TLDs", "URLs"]];
  const records = transformed.map(row => [
    row.tlds.join(", "),    // Convert array to comma-separated string
    row.urls.join(", ")     // Convert array to comma-separated string
  ]);

  const csv = stringify([...header, ...records]);
  fs.writeFileSync(RDAP_CSV_FILE, csv, "utf-8");
}

/**
 * Save RDAP bootstrap services as a JSON file
 */
async function saveRDAPJson(services: any[][]) {
  fs.writeFileSync(RDAP_JSON_FILE, JSON.stringify(services, null, 2), "utf-8");
}

/**
 * Save DNSSEC data as a CSV file
 */
async function saveDnssecCsv(dnssecData: DNSSECData[]) {
  const header = [["Domain", "DNSSEC"]];
  const records = dnssecData.map(entry => [
    entry.domain,
    entry.dnssec ? "Yes" : "No"
  ]);

  const csv = stringify([...header, ...records]);
  fs.writeFileSync(DNSSEC_CSV_FILE, csv, "utf-8");
}

/**
 * Save DNSSEC data as a JSON file
 */
async function saveDnssecJson(dnssecData: DNSSECData[]) {
  fs.writeFileSync(DNSSEC_JSON_FILE, JSON.stringify(dnssecData, null, 2), "utf-8");
}

/**
 * Save merged TLD + RDAP + DNSSEC data as a JSON file
 */
async function saveMergedJson(mergedData: any[]) {
  fs.writeFileSync(COMBINED_JSON_FILE, JSON.stringify(mergedData, null, 2), "utf-8");
}

/**
 * Save merged TLD + RDAP + DNSSEC data as a CSV file
 */
async function saveMergedCsv(mergedData: any[]) {
  const header = [["Domain", "Type", "TLD Manager", "RDAP URLs", "DNSSEC"]];
  const records = mergedData.map(row => [
    row.domain,
    row.type,
    row.tldManager,
    row.rdap.join(", "),
    row.dnssec ? "Yes" : "No"
  ]);

  const csv = stringify([...header, ...records]);
  fs.writeFileSync(COMBINED_CSV_FILE, csv, "utf-8");
}

/**
 * Main function to orchestrate the update
 */
async function main() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log("Fetching TLD data from IANA...");
  const tldRows = await fetchTlds();

  console.log("Fetching RDAP bootstrap data from IANA...");
  const rdapServices = await fetchRdapBootstrap();

  console.log("Fetching DNSSEC data from InterNIC...");
  const dnssecMap = await fetchDnssecData();
  const dnssecDataArray = dnssecMapToArray(dnssecMap);

  console.log("Merging TLD with RDAP and DNSSEC data...");
  const mergedData = mergeTldWithRdapAndDnssec(tldRows, rdapServices, dnssecMap);

  console.log(`Fetched ${tldRows.length} TLDs, ${rdapServices.length} RDAP services, and ${dnssecMap.size} DNSSEC entries. Saving...`);
  
  await saveTldCsv(tldRows);
  await saveTldJson(tldRows);
  await saveRDAPCsv(rdapServices);
  await saveRDAPJson(rdapServices);
  await saveDnssecCsv(dnssecDataArray);
  await saveDnssecJson(dnssecDataArray);
  await saveMergedJson(mergedData);
  await saveMergedCsv(mergedData);

  console.log("✅ All data updated!");
  console.log(`📁 Files saved:
  - ${TLD_JSON_FILE}
  - ${TLD_CSV_FILE}
  - ${RDAP_JSON_FILE}
  - ${RDAP_CSV_FILE}
  - ${DNSSEC_JSON_FILE}
  - ${DNSSEC_CSV_FILE}
  - ${COMBINED_JSON_FILE}
  - ${COMBINED_CSV_FILE}`);
}

// Run the script
main().catch(err => {
  console.error(err);
  process.exit(1);
});