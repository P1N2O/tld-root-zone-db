#!/usr/bin/env ts-node

import "dotenv/config";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { processCentralizedZone } from "./jobs/centralized-zone.mts";
import { processRootZone } from "./jobs/root-zone.mts";
import { Database } from "./utils/database.mts";

interface CliArgs {
	job?: string;
	save?: string;
}

async function main() {
	const argv = await yargs(hideBin(process.argv))
		.option("job", {
			type: "string",
			choices: ["root-zone", "centralized-zone"],
			description: "Which job to run",
		})
		.option("save", {
			type: "string",
			choices: ["local", "remote"],
			description: "Where to save results",
		})
		.parse();

	const args: CliArgs = argv;
	const saveLocal = args.save === "local";
	const saveRemote = args.save !== "local" && Database.hasConfig();

	console.log("🚀 Starting TLD Root Zone Processor");
	console.log(
		`📊 Mode: ${saveLocal ? "Local only" : saveRemote ? "Remote + Local" : "Local only"}`,
	);
	console.log(`🔧 Jobs: ${args.job || "All"}`);

	try {
		// Initialize database if remote saving is enabled
		const db = saveRemote ? new Database() : null;
		if (db) {
			await db.connect();
		}

		// Process jobs based on arguments
		if (!args.job || args.job === "root-zone") {
			console.log("\n=== Processing Root Zone ===");
			await processRootZone(db);
		}

		if (!args.job || args.job === "centralized-zone") {
			console.log("\n=== Processing Centralized Zone ===");
			await processCentralizedZone(db);
		}

		if (db) {
			await db.disconnect();
		}

		console.log("\n✅ All jobs completed successfully!");
	} catch (error) {
		console.error("\n❌ Error:", error);
		process.exit(1);
	}
}

main().catch(console.error);
