import fs from "fs";
import { jwtDecode } from "jwt-decode";
import path from "path";
import zlib from "zlib";
import type { Database } from "../utils/database.mts";
import { fetchWithRetry, sleep } from "../utils/fetcher.mts";
import { FileWriter } from "../utils/file-writer.mts";

const AUTH_URL = "https://account-api.icann.org/api/authenticate";
const DOWNLOAD_LINKS_URL = "https://czds-api.icann.org/czds/downloads/links";
const DATA_DIR = "./data/centralized-zone";

interface TokenCache {
	accessToken: string;
	expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export async function processCentralizedZone(
	db: Database | null = null,
): Promise<void> {
	console.log("Fetching centralized zone data...");

	try {
		const downloadLinks = await fetchDownloadLinks();
		console.log(`Found ${downloadLinks.length} zone files to download`);

		if (db) {
			await processZoneFilesToDatabase(downloadLinks, db);
		}

		// Only save files locally if no DB or explicitly requested
		if (!db || process.env.SAVE_FILES === "true") {
			await processZoneFilesToLocal(downloadLinks);
		}
	} catch (error) {
		console.error("Error processing centralized zone:", error);
		throw error;
	}
}

async function fetchDownloadLinks(): Promise<string[]> {
	const token = await getValidToken();
	const response = await fetchWithRetry(DOWNLOAD_LINKS_URL, {
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});

	const data = await response.json();
	if (!Array.isArray(data)) {
		throw new Error("Invalid API response: expected array");
	}

	return data;
}

async function getValidToken(): Promise<string> {
	// Check cache first
	if (tokenCache && !isTokenExpired(tokenCache.accessToken)) {
		return tokenCache.accessToken;
	}

	// Get new token
	const response = await fetchWithRetry(AUTH_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: process.env.CZDS_USERNAME,
			password: process.env.CZDS_PASSWORD,
		}),
	});

	const authData = await response.json() as { accessToken: string; expiresIn: number };
	tokenCache = {
		accessToken: authData.accessToken,
		expiresAt: Date.now() + authData.expiresIn * 1000,
	};

	return authData.accessToken;
}

function isTokenExpired(token: string): boolean {
	try {
		const decoded = jwtDecode<{ exp: number }>(token);
		return decoded.exp * 1000 < Date.now() + 300000; // 5 minute buffer
	} catch {
		return true;
	}
}

async function processZoneFilesToDatabase(
	downloadLinks: string[],
	db: Database,
): Promise<void> {
	console.log("Processing zone files to database...");
	await db.initializeTables();

	for (let i = 0; i < downloadLinks.length; i++) {
		const url = downloadLinks[i];
		const filename = path.basename(url);
		const tld = filename.split(".")[0];

		console.log(`Processing ${i + 1}/${downloadLinks.length}: ${tld}`);

		try {
			const { domainCount, fileSize } = await downloadAndProcessZone(
				url,
				tld,
				db,
			);
			console.log(`  ✅ ${domainCount} domains processed for ${tld}`);

			if (i < downloadLinks.length - 1) {
				await sleep(1000);
			}
		} catch (error) {
			console.error(`  ❌ Failed to process ${tld}:`, error);
		}
	}
}

async function processZoneFilesToLocal(downloadLinks: string[]): Promise<void> {
	FileWriter.ensureDirectory(DATA_DIR);
	console.log("Processing zone files to local storage...");

	for (let i = 0; i < downloadLinks.length; i++) {
		const url = downloadLinks[i];
		const filename = path.basename(url);
		const gzPath = path.join(DATA_DIR, filename);
		const tld = filename.split(".")[0];
		const txtPath = path.join(DATA_DIR, `${tld}.txt`);

		console.log(`Processing ${i + 1}/${downloadLinks.length}: ${tld}`);

		try {
			await downloadFile(url, gzPath);
			await extractAndProcessFile(gzPath, txtPath, tld);

			if (i < downloadLinks.length - 1) {
				await sleep(1000);
			}
		} catch (error) {
			console.error(`  ❌ Failed to process ${tld}:`, error);
		}
	}
}

async function downloadAndProcessZone(
	url: string,
	tld: string,
	db: Database,
): Promise<{ domainCount: number; fileSize: number }> {
	const token = await getValidToken();
	const response = await fetchWithRetry(url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	const buffer = await response.arrayBuffer();
	const decompressed = zlib.gunzipSync(Buffer.from(buffer));
	const content = decompressed.toString("utf-8");
	const domains = new Set<string>();

	content.split("\n").forEach((line) => {
		if (!line.trim() || line.startsWith(";")) return;
		const domain = extractDomainFromLine(line);
		if (domain) domains.add(domain);
	});

	// Save to database
	const client = db.getClient();
	const tldResult = await client.query(
		"INSERT INTO tlds (domain, search_available, domain_count, zone_file_size) VALUES ($1, $2, $3, $4) ON CONFLICT (domain) DO UPDATE SET search_available = $2, domain_count = $3, zone_file_size = $4 RETURNING id",
		[tld, true, domains.size, decompressed.length],
	);

	const tldId = tldResult.rows[0].id;

	// Bulk insert domains (simplified)
	for (const domain of domains) {
		await client.query(
			"INSERT INTO zone_domains (tld_id, domain_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
			[tldId, domain],
		);
	}

	return { domainCount: domains.size, fileSize: decompressed.length };
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
	const token = await getValidToken();
	const response = await fetchWithRetry(url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	const buffer = await response.arrayBuffer();
	fs.writeFileSync(outputPath, Buffer.from(buffer));
}

async function extractAndProcessFile(
	gzPath: string,
	txtPath: string,
	tld: string,
): Promise<void> {
	const buffer = fs.readFileSync(gzPath);
	const decompressed = zlib.gunzipSync(buffer);
	const content = decompressed.toString("utf-8");
	const domains = new Set<string>();

	content.split("\n").forEach((line) => {
		if (!line.trim() || line.startsWith(";")) return;
		const domain = extractDomainFromLine(line);
		if (domain) domains.add(domain);
	});

	fs.writeFileSync(txtPath, Array.from(domains).sort().join("\n"));
	fs.unlinkSync(gzPath);
}

function extractDomainFromLine(line: string): string | null {
	const parts = line.trim().split(/\s+/);
	if (parts.length === 0) return null;

	let domain = parts[0].toLowerCase();
	if (domain.endsWith(".")) {
		domain = domain.slice(0, -1);
	}

	return domain && !domain.startsWith(";") ? domain : null;
}
