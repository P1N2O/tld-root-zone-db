# TLD Root Zone DB

[![Update TLD Data and Deploy](https://github.com/P1N2O/tld-root-zone-db/actions/workflows/update-data.yml/badge.svg)](https://github.com/P1N2O/tld-root-zone-db/actions/workflows/update-data.yml)

**Daily Snapshot of the IANA Root Zone Database**

TLD Root Zone DB is an updated daily snapshot of the [IANA Root Zone Database](https://www.iana.org/domains/root/db), which contains `TLD Type`, `TLD Manager`, `RDAP Endpoint` and `DNSSEC` information for all top-level domains (TLDs).

## Features

- **Free & Open Source**: No rate limits and no API keys required
- **Automated Daily Updates**: Scheduled to run every day at 6:30 UTC
- **Smart Commit System**: Only commits changes if data actually changes
- **Data Source**: TLD and RDAP data is fetched from [IANA](https://www.iana.org/) and DNSSEC data from [InterNIC](https://www.internic.net/)
- **Multiple Output Formats**: JSON and CSV files for easy integration
- **Comprehensive Data Sets**:
  - Individual TLD, RDAP, and DNSSEC files
  - Combined datasets with merged TLD + RDAP + DNSSEC information

## Data Endpoints

| Dataset | JSON | CSV |
|:--------|:-----|:----|
| **Combined Data** | [https://iana.api.pinto.dev/combined.json](https://iana.api.pinto.dev/combined.json) | [https://iana.api.pinto.dev/combined.csv](https://iana.api.pinto.dev/combined.csv) |
| **TLD Data** | [https://iana.api.pinto.dev/tld.json](https://iana.api.pinto.dev/tld.json) | [https://iana.api.pinto.dev/tld.csv](https://iana.api.pinto.dev/tld.csv) |
| **RDAP Data** | [https://iana.api.pinto.dev/rdap.json](https://iana.api.pinto.dev/rdap.json) | [https://iana.api.pinto.dev/rdap.csv](https://iana.api.pinto.dev/rdap.csv) |
| **DNSSEC Data** | [https://iana.api.pinto.dev/dnssec.json](https://iana.api.pinto.dev/dnssec.json) | [https://iana.api.pinto.dev/dnssec.csv](https://iana.api.pinto.dev/dnssec.csv) |

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