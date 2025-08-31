import * as cheerio from "cheerio";
import type { Database } from "../utils/database.mts";
import { fetchWithRetry } from "../utils/fetcher.mts";
import { FileWriter } from "../utils/file-writer.mts";

const IANA_ROOT_ZONE_URL = "https://www.iana.org/domains/root/db";
const IANA_RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const INTERNIC_ROOT_ZONE_URL = "https://www.internic.net/domain/root.zone";

interface TLDRow {
	domain: string;
	type: string;
	tldManager: string;
}

interface IanaRdapBootstrap {
	services: any[][];
}

export async function processRootZone(
	db: Database | null = null,
): Promise<void> {
	console.log("Fetching root zone data...");

	const [tldRows, rdapServices, dnssecMap] = await Promise.all([
		fetchTlds(),
		fetchRdapBootstrap(),
		fetchDnssecData(),
	]);

	console.log(
		`Fetched ${tldRows.length} TLDs, ${rdapServices.length} RDAP services`,
	);

	// Merge data
	const rdapMap = createRdapMap(rdapServices);
	const combinedData = mergeData(tldRows, rdapMap, dnssecMap, db);

	// Save files locally
	saveLocalFiles(tldRows, rdapServices, dnssecMap, combinedData);

	// Save to database if available
	if (db) {
		await saveToDatabase(db, tldRows, rdapMap, dnssecMap, combinedData);
	}
}

async function fetchTlds(): Promise<TLDRow[]> {
	const response = await fetchWithRetry(IANA_ROOT_ZONE_URL);
	const html = await response.text();
	const $ = cheerio.load(html);
	const rows: TLDRow[] = [];

	$("table.iana-table tbody tr").each((_, el) => {
		const cols = $(el)
			.find("td")
			.map((_, td) => $(td).text().trim())
			.get();
		if (cols.length === 3) {
			rows.push({ domain: cols[0], type: cols[1], tldManager: cols[2] });
		}
	});

	return rows;
}

async function fetchRdapBootstrap(): Promise<any[][]> {
	const response = await fetchWithRetry(IANA_RDAP_BOOTSTRAP_URL);
	const data: IanaRdapBootstrap = await response.json() as IanaRdapBootstrap;
	return data.services;
}

async function fetchDnssecData(): Promise<Map<string, boolean>> {
	const response = await fetchWithRetry(INTERNIC_ROOT_ZONE_URL);
	const zoneData = await response.text();
	const dnssecMap = new Map<string, boolean>();

	zoneData.split("\n").forEach((line) => {
		if (!line.trim() || line.startsWith(";")) return;

		const parts = line.split(/\s+/).filter((part) => part !== "");
		if (parts.length >= 4 && parts[3] === "DS" && parts[0].endsWith(".")) {
			const tld = parts[0].toLowerCase().slice(0, -1);
			dnssecMap.set(tld, true);
		}
	});

	return dnssecMap;
}

function createRdapMap(services: any[][]): Map<string, string[]> {
	const rdapMap = new Map<string, string[]>();
	services.forEach(([tlds, urls]) => {
		tlds.forEach((tld: string) => {
			rdapMap.set(tld.toLowerCase(), urls);
		});
	});
	return rdapMap;
}

function mergeData(
	tldRows: TLDRow[],
	rdapMap: Map<string, string[]>,
	dnssecMap: Map<string, boolean>,
	db: Database | null,
): any[] {
	return tldRows.map((tld) => {
		const tldWithoutDot = tld.domain.replace(/^\./, "").toLowerCase();
		return {
			...tld,
			rdap: rdapMap.get(tldWithoutDot) || [],
			dnssec: dnssecMap.get(tldWithoutDot) || false,
			search: db ? true : false, // Simplified for example
		};
	});
}

function saveLocalFiles(
	tldRows: TLDRow[],
	rdapServices: any[][],
	dnssecMap: Map<string, boolean>,
	combinedData: any[],
): void {
	const dataDir = "./data/root-zone";

	// Save TLD data
	FileWriter.writeJson(`${dataDir}/tld.json`, tldRows);
	FileWriter.writeCsv(
		`${dataDir}/tld.csv`,
		tldRows.map((r) => [r.domain, r.type, r.tldManager]),
		["Domain", "Type", "TLD Manager"],
	);

	// Save RDAP data
	FileWriter.writeJson(`${dataDir}/rdap.json`, rdapServices);
	const rdapCsvData = rdapServices.map(([tlds, urls]) => [
		tlds.join(", "),
		urls.join(", "),
	]);
	FileWriter.writeCsv(`${dataDir}/rdap.csv`, rdapCsvData, ["TLDs", "URLs"]);

	// Save DNSSEC data
	const dnssecData = Array.from(dnssecMap.entries()).map(
		([domain, dnssec]) => ({ domain, dnssec }),
	);
	FileWriter.writeJson(`${dataDir}/dnssec.json`, dnssecData);
	FileWriter.writeCsv(
		`${dataDir}/dnssec.csv`,
		dnssecData.map((d) => [d.domain, d.dnssec ? "Yes" : "No"]),
		["Domain", "DNSSEC"],
	);

	// Save combined data
	FileWriter.writeJson(`${dataDir}/combined.json`, combinedData);
	FileWriter.writeCsv(
		`${dataDir}/combined.csv`,
		combinedData.map((row) => [
			row.domain,
			row.type,
			row.tldManager,
			row.rdap.join(", "),
			row.dnssec ? "Yes" : "No",
			row.search ? "Yes" : "No",
		]),
		["Domain", "Type", "TLD Manager", "RDAP URLs", "DNSSEC", "Search"],
	);

	console.log("✅ Root zone files saved locally");
}

async function saveToDatabase(
  db: Database, 
  tldRows: TLDRow[], 
  rdapMap: Map<string, string[]>, 
  dnssecMap: Map<string, boolean>,
  combinedData: any[]
): Promise<void> {
  const client = db.getClient();
  
  // Initialize tables if needed
  await db.initializeTables();

  console.log(`📊 Starting database insert for ${tldRows.length} TLDs...`);

  let successful = 0;
  let failed = 0;

  // Save TLD data to database
  for (let i = 0; i < tldRows.length; i++) {
    const tld = tldRows[i];
    const tldWithoutDot = tld.domain.replace(/^\./, '').toLowerCase();
    const rdapUrls = rdapMap.get(tldWithoutDot) || [];
    const hasDnssec = dnssecMap.get(tldWithoutDot) || false;

    // Convert array to proper JSON string
    const rdapUrlsJson = JSON.stringify(rdapUrls);

    // Update progress on the same line
    process.stdout.write(`   Processing TLD ${i + 1}/${tldRows.length}: ${tld.domain} (✅ ${successful} ❌ ${failed})...\r`);

    try {
      await client.query(`
        INSERT INTO tlds (domain, type, tld_manager, rdap_urls, dnssec, last_updated)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (domain) 
        DO UPDATE SET 
          type = EXCLUDED.type,
          tld_manager = EXCLUDED.tld_manager,
          rdap_urls = EXCLUDED.rdap_urls,
          dnssec = EXCLUDED.dnssec,
          last_updated = NOW()
      `, [tldWithoutDot, tld.type, tld.tldManager, rdapUrlsJson, hasDnssec]);
      
      successful++;

    } catch (error: any) {
      console.error(`\n   ❌ Failed to insert ${tld.domain}:`, error.message);
      failed++;
      // Continue with next record instead of failing completely
    }
  }

  // Clear the progress line and show final result
  process.stdout.write('\r'.padEnd(process.stdout.columns) + '\r');
  console.log(`✅ Root zone data saved to database (✅ ${successful} successful, ❌ ${failed} failed)`);
}
