import { stringify } from "csv-stringify/sync";
import fs from "fs";
import path from "path";

export class FileWriter {
	static ensureDirectory(dirPath: string): void {
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}
	}

	static writeJson(filePath: string, data: any): void {
		FileWriter.ensureDirectory(path.dirname(filePath));
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
	}

	static writeCsv(filePath: string, data: any[], headers: string[]): void {
		FileWriter.ensureDirectory(path.dirname(filePath));
		const csvData = [headers, ...data];
		const csv = stringify(csvData);
		fs.writeFileSync(filePath, csv);
	}
}
