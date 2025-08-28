# TLD Root Zone DB

[![Update TLD Data and Deploy](https://github.com/P1N2O/tld-root-zone-db/actions/workflows/update-tlds.yml/badge.svg)](https://github.com/P1N2O/tld-root-zone-db/actions/workflows/update-tlds.yml)

**Updated Daily Dump of the IANA Root Zone Database**

This project provides a daily dump of the [IANA Root Zone Database](https://www.iana.org/domains/root/db), which contains `TLD Type` and `TLD Manager` for all top-level domains (TLDs).

## Features

- Fetches the latest TLD data from IANA.
- Scheduled to update daily (at 6:30 UTC).
- No commit is made to the repository if the data hasn't changed.
- The TLD data is available in [JSON](https://p1n2o.github.io/tld-root-zone-db/tlds.json) and [CSV](https://p1n2o.github.io/tld-root-zone-db/tlds.csv) format.

## API Usage

- JSON: [https://p1n2o.github.io/tld-root-zone-db/tlds.json](https://p1n2o.github.io/tld-root-zone-db/tlds.json)
- CSV: [https://p1n2o.github.io/tld-root-zone-db/tlds.csv](https://p1n2o.github.io/tld-root-zone-db/tlds.csv)

## Installation

```bash
git clone https://github.com/P1N2O/tld-root-zone-db.git
cd tld-root-zone-db
npm install

## Usage
```bash
npm run update
```

## License
This project is licensed under the [MIT License](LICENSE).