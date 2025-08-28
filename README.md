# TLD Root Zone Dump

**Dump of the IANA Root Zone Database**

This project provides a daily dump of the [IANA Root Zone Database](https://www.iana.org/domains/root/db), which contains information about all top-level domains (TLDs).

## Features

- Fetches the latest TLD data from IANA.
- Updated daily (at 6:30 UTC).
- Exports the data in [JSON](https://raw.githubusercontent.com/P1N2O/tld-root-zone-dump/main/data/tlds.json) and [CSV](https://raw.githubusercontent.com/P1N2O/tld-root-zone-dump/main/data/tlds.csv) format.

## API Usage

- JSON: [https://raw.githubusercontent.com/P1N2O/tld-root-zone-dump/main/data/tlds.json](https://raw.githubusercontent.com/P1N2O/tld-root-zone-dump/main/data/tlds.json)
- CSV: [https://raw.githubusercontent.com/P1N2O/tld-root-zone-dump/main/data/tlds.csv](https://raw.githubusercontent.com/P1N2O/tld-root-zone-dump/main/data/tlds.csv)

## Installation

```bash
git clone https://github.com/P1N2O/tld-root-zone-dump.git
cd tld-root-zone-dump
npm install

## Usage
```bash
npm run update
```

## License
This project is licensed under the [MIT License](LICENSE).