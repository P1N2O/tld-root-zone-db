import { Client } from 'pg';

export class Database {
  private client: Client | null = null;

  static hasConfig(): boolean {
    return !!(process.env.DATABASE_URL);
  }

  constructor() {
    if (!Database.hasConfig()) {
      throw new Error('Database configuration not found in environment variables');
    }

    this.client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
  }

  async connect(): Promise<void> {
    if (!this.client) throw new Error('Database client not initialized');
    await this.client.connect();
    console.log('✅ Connected to PostgreSQL database');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      console.log('✅ Disconnected from database');
    }
  }

  getClient(): Client {
    if (!this.client) throw new Error('Database client not initialized');
    return this.client;
  }

  async initializeTables(): Promise<void> {
    const client = this.getClient();
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS tlds (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(255) NOT NULL UNIQUE,
        type VARCHAR(50),
        tld_manager TEXT,
        rdap_urls JSONB,
        dnssec BOOLEAN DEFAULT FALSE,
        search_available BOOLEAN DEFAULT FALSE,
        zone_file_size BIGINT,
        domain_count BIGINT,
        last_updated TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS zone_domains (
        id BIGSERIAL PRIMARY KEY,
        tld_id INTEGER REFERENCES tlds(id),
        domain_name VARCHAR(253) NOT NULL,
        is_available BOOLEAN DEFAULT TRUE,
        first_seen TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tld_id, domain_name)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_zone_domains_name 
      ON zone_domains(domain_name)
    `);

    console.log('✅ Database tables initialized');
  }
}