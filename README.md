# TLD Root Zone DB

[![Update TLD Data and Deploy](https://github.com/P1N2O/tld-root-zone-db/actions/workflows/update-tld.yml/badge.svg)](https://github.com/P1N2O/tld-root-zone-db/actions/workflows/update-tld.yml)

**Updated Daily Dump of the IANA Root Zone Database**

This project provides a daily dump of the [IANA Root Zone Database](https://www.iana.org/domains/root/db), which contains `TLD Type` and `TLD Manager` for all top-level domains (TLDs).

## Features

- Fetches the latest TLD and RDAP data from IANA.
- Scheduled to update daily (at 6:30 UTC).
- No commit is made to the repository if the data hasn't changed.

## 📊 Data Endpoints

| Dataset | JSON | CSV |
|:--------|:-----|:----|
| **TLD Data** | [https://iana.api.pinto.dev/tld.json](https://iana.api.pinto.dev/tld.json) | [https://iana.api.pinto.dev/tld.csv](https://iana.api.pinto.dev/tld.csv) |
| **RDAP Data** | [https://iana.api.pinto.dev/rdap.json](https://iana.api.pinto.dev/rdap.json) | [https://iana.api.pinto.dev/rdap.csv](https://iana.api.pinto.dev/rdap.csv) |

## Installation

```bash
git clone https://github.com/P1N2O/tld-root-zone-db.git
cd tld-root-zone-db
npm install
```

## Usage
```bash
npm run update
```

## License
This project is licensed under the [MIT License](LICENSE).