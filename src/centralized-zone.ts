import * as fs from "fs";
import * as https from "https";
import { jwtDecode } from "jwt-decode";
import fetch from "node-fetch";
import * as zlib from "node:zlib";
import * as path from "path";
import { fileURLToPath } from "url";

/**
 * Resolve paths relative to the current file
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directory for storing extracted zone files
const DATA_DIR = path.join(__dirname, "..", "data", "centralized-zone");

/**
 * Force IPv4 in environments (e.g. CI/CD, GitHub Actions)
 * where IPv6 can cause timeouts when fetching from IANA
 */
const httpsAgent = new https.Agent({ family: 4 });

// Authentication and API URLs
const AUTH_URL = "https://account-api.icann.org/api/authenticate";
const DOWNLOAD_LINKS_URL = "https://czds-api.icann.org/czds/downloads/links";

// Token cache structure
interface TokenCache {
	accessToken: string;
	expiresAt: number;
}

// JWT payload structure
interface JwtPayload {
	exp: number;
	iat: number;
	[key: string]: any;
}

// Token cache file path
const TOKEN_CACHE_FILE = path.join(__dirname, "..", "token-cache.json");

/**
 * Authentication response structure
 */
interface AuthResponse {
	accessToken: string;
	expiresIn: number;
}

/**
 * Download links response structure
 */
interface DownloadLinksResponse {
	links: string[];
}

/**
 * Check if a JWT token is expired or about to expire
 */
function isTokenExpired(token: string, bufferSeconds: number = 300): boolean {
	try {
		const decoded = jwtDecode<JwtPayload>(token);
		const currentTime = Math.floor(Date.now() / 1000);
		return decoded.exp - bufferSeconds <= currentTime;
	} catch (error) {
		console.warn("Failed to decode token, considering it expired:", error);
		return true;
	}
}

/**
 * Get cached token if it exists and is still valid
 */
function getCachedToken(): TokenCache | null {
	try {
		if (fs.existsSync(TOKEN_CACHE_FILE)) {
			const cachedData = JSON.parse(
				fs.readFileSync(TOKEN_CACHE_FILE, "utf-8"),
			) as TokenCache;

			// Check if token is still valid using JWT expiration
			if (!isTokenExpired(cachedData.accessToken)) {
				console.log("✅ Using valid cached token");
				return cachedData;
			} else {
				console.log("🔄 Cached token expired, will authenticate again");
			}
		}
	} catch (error) {
		// If there's any error reading the cache, treat as no cached token
		console.warn(
			"Warning: Could not read token cache, proceeding without cached token:",
			error,
		);
	}
	return null;
}

/**
 * Save token to cache
 */
function saveTokenToCache(token: string, expiresIn: number): void {
	try {
		const decoded = jwtDecode<JwtPayload>(token);
		const expiresAt = decoded.exp * 1000; // Convert to milliseconds

		const cacheData: TokenCache = { accessToken: token, expiresAt };

		fs.writeFileSync(
			TOKEN_CACHE_FILE,
			JSON.stringify(cacheData, null, 2),
			"utf-8",
		);
		console.log("✅ Token saved to cache");
	} catch (error) {
		console.warn("Warning: Could not save token to cache:", error);
	}
}

/**
 * Authenticate with IANA CZDS API and get access token
 */
async function authenticate(): Promise<AuthResponse> {
	console.log("Authenticating with IANA CZDS API...");

	const requestBody = {
		username: process.env.CZDS_USERNAME,
		password: process.env.CZDS_PASSWORD,
	};

	const response = await fetch(AUTH_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
		agent: httpsAgent,
	});

	if (!response.ok) {
		throw new Error(
			`Authentication failed: ${response.status} ${response.statusText}`,
		);
	}

	const authData = (await response.json()) as AuthResponse;

	// Save token to cache
	saveTokenToCache(authData.accessToken, authData.expiresIn);

	console.log("✅ Authentication successful");
	return authData;
}

/**
 * Get a valid access token, using cache if available
 */
async function getValidToken(): Promise<string> {
	// Check for cached valid token first
	const cachedToken = getCachedToken();
	if (cachedToken) {
		return cachedToken.accessToken;
	}

	// No valid cached token, authenticate to get a new one
	const authResponse = await authenticate();
	return authResponse.accessToken;
}

/**
 * Wait for a specified amount of time
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get a valid access token with retry logic for rate limiting
 */
async function getValidTokenWithRetry(maxRetries: number = 3): Promise<string> {
	let retryCount = 0;

	while (retryCount < maxRetries) {
		try {
			return await getValidToken();
		} catch (error: any) {
			if (
				error.message.includes("429") ||
				error.message.includes("Too Many Requests")
			) {
				retryCount++;
				const delay = Math.min(1000 * 2 ** retryCount, 30000); // Exponential backoff, max 30s
				console.log(
					`⏳ Rate limited, waiting ${delay}ms before retry ${retryCount}/${maxRetries}...`,
				);
				await sleep(delay);
				continue;
			}
			throw error;
		}
	}

	throw new Error(`Max retries (${maxRetries}) exceeded for authentication`);
}

/**
 * Fetch download links for zone files from CZDS API
 */
async function fetchDownloadLinks(): Promise<string[]> {
	console.log("Fetching download links...");

	const token = await getValidToken();

	const response = await fetch(DOWNLOAD_LINKS_URL, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		agent: httpsAgent,
	});

	if (!response.ok) {
		// If unauthorized, clear cache and try again
		if (response.status === 401) {
			console.log("🔄 Token expired, clearing cache and retrying...");
			try {
				if (fs.existsSync(TOKEN_CACHE_FILE)) {
					fs.unlinkSync(TOKEN_CACHE_FILE);
				}
			} catch (error) {
				// Ignore cleanup errors
			}
			const newToken = await getValidToken();

			const retryResponse = await fetch(DOWNLOAD_LINKS_URL, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${newToken}`,
					"Content-Type": "application/json",
				},
				agent: httpsAgent,
			});

			if (!retryResponse.ok) {
				throw new Error(
					`Failed to fetch download links after token refresh: ${retryResponse.status} ${retryResponse.statusText}`,
				);
			}

			const data = await retryResponse.json();
			if (!Array.isArray(data)) {
				console.error("Invalid API response structure:", data);
				throw new Error(
					"Invalid API response: expected array but got different structure",
				);
			}

			console.log(`✅ Found ${data.length} download links`);
			return data;
		}

		throw new Error(
			`Failed to fetch download links: ${response.status} ${response.statusText}`,
		);
	}

	const data = await response.json();

	// The API returns an array directly, not an object with a 'links' property
	if (!Array.isArray(data)) {
		console.error("Invalid API response structure:", data);
		throw new Error(
			"Invalid API response: expected array but got different structure",
		);
	}

	console.log(`✅ Found ${data.length} download links`);
	return data;
}

/**
 * Download a file from a URL and save it to the specified path
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
	try {
		console.log(`  📥 Downloading ${path.basename(url)}...`);

		const token = await getValidTokenWithRetry();

		const response = await fetch(url, {
			method: "GET",
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; IANA CZDS Downloader)",
				Authorization: `Bearer ${token}`,
			},
			agent: httpsAgent,
			// Follow redirects automatically
			redirect: "follow",
		});

		if (!response.ok) {
			// Only try to unlink if file exists
			try {
				if (fs.existsSync(outputPath)) {
					fs.unlinkSync(outputPath);
				}
			} catch (cleanupError) {
				// Ignore cleanup errors
			}
			throw new Error(
				`Failed to download ${url}: ${response.status} ${response.statusText}`,
			);
		}

		// Create write stream and pipe the response to it
		const fileStream = fs.createWriteStream(outputPath);
		const body = response.body;

		if (!body) {
			// Only try to unlink if file exists
			try {
				if (fs.existsSync(outputPath)) {
					fs.unlinkSync(outputPath);
				}
			} catch (cleanupError) {
				// Ignore cleanup errors
			}
			throw new Error(`Failed to download ${url}: response body is null`);
		}

		body.pipe(fileStream);

		return new Promise((resolve, reject) => {
			fileStream.on("finish", () => {
				fileStream.close();
				resolve();
			});

			fileStream.on("error", (error) => {
				// Only try to unlink if file exists
				try {
					if (fs.existsSync(outputPath)) {
						fs.unlinkSync(outputPath);
					}
				} catch (cleanupError) {
					// Ignore cleanup errors
				}
				reject(error);
			});
		});
	} catch (error) {
		// Clean up partial file if it exists
		try {
			if (fs.existsSync(outputPath)) {
				fs.unlinkSync(outputPath);
			}
		} catch (cleanupError) {
			// Ignore cleanup errors
		}
		throw error;
	}
}

/**
 * Extract a .gz file to the specified output path
 */
async function extractGzFile(
	gzPath: string,
	outputPath: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		// Read the entire file into memory first for better validation
		fs.readFile(gzPath, (readError, data) => {
			if (readError) {
				reject(new Error(`Failed to read gz file: ${readError.message}`));
				return;
			}

			// Validate gzip file format (first two bytes should be 0x1f 0x8b)
			if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) {
				reject(new Error(`Invalid gzip file format: ${gzPath}`));
				return;
			}

			// Try to decompress using zlib
			zlib.gunzip(data, (gunzipError, decompressedData) => {
				if (gunzipError) {
					console.error("Gunzip error:", gunzipError);
					reject(
						new Error(`Failed to decompress ${gzPath}: ${gunzipError.message}`),
					);
					return;
				}

				// Write the decompressed data to output file
				fs.writeFile(outputPath, decompressedData, (writeError) => {
					if (writeError) {
						reject(
							new Error(
								`Failed to write extracted file: ${writeError.message}`,
							),
						);
						return;
					}

					// Clean up the .gz file
					try {
						fs.unlinkSync(gzPath);
					} catch (cleanupError) {
						console.warn("Warning: Could not clean up gz file:", cleanupError);
					}

					resolve();
				});
			});
		});
	});
}

/**
 * Process zone file to extract unique domain names and replace the file content
 */
async function processZoneFile(txtPath: string): Promise<void> {
	console.log(`  🔍 Processing ${path.basename(txtPath)} for domain names...`);

	const domainNames = new Set<string>();
	const fileContent = fs.readFileSync(txtPath, "utf-8");
	const lines = fileContent.split("\n");

	for (const line of lines) {
		if (!line.trim() || line.startsWith(";") || line.startsWith("$")) {
			continue; // Skip empty lines and comments
		}

		// Split by whitespace and get the first field (domain name)
		const parts = line.trim().split(/\s+/);
		if (parts.length > 0) {
			const domain = parts[0].toLowerCase();

			// Remove trailing dot if present
			const cleanDomain = domain.endsWith(".") ? domain.slice(0, -1) : domain;

			if (cleanDomain && !cleanDomain.startsWith(";")) {
				domainNames.add(cleanDomain);
			}
		}
	}

	// Convert to sorted array and write back to the same file
	const domainsArray = Array.from(domainNames).sort();
	fs.writeFileSync(txtPath, domainsArray.join("\n"), "utf-8");

	console.log(
		`  ✅ Extracted ${domainNames.size} unique domain names to ${path.basename(txtPath)}`,
	);
}

/**
 * Download and extract zone files from the provided URLs
 */
async function downloadAndExtractZoneFiles(
	downloadUrls: string[],
): Promise<void> {
	console.log("Setting up data directory...");

	// Ensure data directory exists
	if (!fs.existsSync(DATA_DIR)) {
		fs.mkdirSync(DATA_DIR, { recursive: true });
	}

	console.log(
		`Downloading and extracting ${downloadUrls.length} zone files...`,
	);

	for (let i = 0; i < downloadUrls.length; i++) {
		const url = downloadUrls[i];
		const filename = path.basename(url);

		// The URLs typically look like: https://czds-api.icann.org/czds/downloads/com.zone.gz
		// We want to extract to com.txt (not com.zone)
		const gzPath = path.join(DATA_DIR, filename);

		// Extract the TLD from the filename (e.g., "com.zone.gz" -> "com")
		const tld = filename.split(".")[0];
		const txtPath = path.join(DATA_DIR, `${tld}.txt`);

		console.log(
			`Processing file ${i + 1}/${downloadUrls.length}: ${filename} -> ${tld}.txt`,
		);

		try {
			// Download the .gz file
			await downloadFile(url, gzPath);
			console.log(`  ✅ Downloaded ${filename}`);

			// Verify the downloaded file has content
			const stats = fs.statSync(gzPath);
			if (stats.size === 0) {
				fs.unlinkSync(gzPath);
				throw new Error(`Downloaded file ${filename} is empty`);
			}

			console.log(`  📊 File size: ${stats.size} bytes`);

			// Extract the .gz file
			try {
				await extractGzFile(gzPath, txtPath);
				console.log(`  ✅ Extracted to ${path.basename(txtPath)}`);
			} catch (extractError) {
				// Clean up the corrupted gz file
				if (fs.existsSync(gzPath)) {
					fs.unlinkSync(gzPath);
				}
				throw new Error(`Failed to extract ${filename}: ${extractError}`);
			}

			// Process the zone file to extract domain names (modify the same file)
			await processZoneFile(txtPath);

			// Add a small delay between downloads to avoid rate limiting
			if (i < downloadUrls.length - 1) {
				console.log(`  ⏳ Waiting 1 second before next download...`);
				await sleep(1000);
			}
		} catch (error) {
			console.error(`  ❌ Failed to process ${filename}:`, error);
			throw error;
		}
	}

	console.log(
		"✅ All zone files downloaded, extracted, and processed successfully",
	);
}

/**
 * Main function to orchestrate the CZDS process
 */
async function main(): Promise<void> {
	try {
		console.log("🚀 Starting IANA CZDS process...");

		// Step 1: Get a valid token (will use cache if available)
		const token = await getValidToken();
		console.log("✅ Token obtained successfully");

		// Step 2: Fetch download links
		const downloadLinks = await fetchDownloadLinks();

		// Step 3: Download and extract zone files
		await downloadAndExtractZoneFiles(downloadLinks);

		console.log("🎉 IANA CZDS process completed successfully!");
		console.log(`📁 Zone files extracted to: ${DATA_DIR}`);

		// List the extracted files
		const files = fs
			.readdirSync(DATA_DIR)
			.filter((file) => file.endsWith(".txt"));
		console.log(`📄 Extracted files: ${files.join(", ")}`);
	} catch (error) {
		console.error("❌ CZDS process failed:", error);
		process.exit(1);
	}
}

// Run the script
main().catch((err) => {
	console.error("Unhandled error:", err);
	process.exit(1);
});
