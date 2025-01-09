class TableHelper {
  constructor(pool) {
    this.pool = pool;
  }

  async createLeadsTable() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Create required extensions
      await client.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

      // Set timezone to Asia/Kolkata (IST)
      await client.query("SET timezone = 'Asia/Kolkata'");

      // Create leads table with quoted camelCase columns and IST timestamps
      await client.query(`
          CREATE TABLE IF NOT EXISTS cladbe_leads (
            "leadId" VARCHAR(50) PRIMARY KEY, 
            "companyId" VARCHAR(255) NOT NULL,
            "ownerId" VARCHAR(255) NOT NULL,
            "coOwnerIds" TEXT[] DEFAULT '{}',
            "mobileNumber" VARCHAR(20) NOT NULL,
            "emailId" VARCHAR(255) NOT NULL,
            "name" VARCHAR(255) NOT NULL,
            "city" VARCHAR(255) NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
            "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
            "deletedAt" TIMESTAMP WITH TIME ZONE,
            CONSTRAINT "uniqueMobilePerCompany" UNIQUE ("companyId", "mobileNumber")
          )
        `);

      // Update audit log table with quoted camelCase columns and IST timestamps
      await client.query(`
          CREATE TABLE IF NOT EXISTS lead_audit_logs (
            "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            "leadId" VARCHAR(50) NOT NULL,  
            "companyId" VARCHAR(255) NOT NULL,
            "action" VARCHAR(50) NOT NULL,
            "actionBy" VARCHAR(255) NOT NULL,
            "previousData" JSONB,
            "newData" JSONB,
            "metadata" JSONB,
            "actionAt" TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
            CONSTRAINT "fkLead" FOREIGN KEY ("leadId") REFERENCES cladbe_leads("leadId") ON DELETE CASCADE
          )
        `);

      // Create basic indexes with camelCase names
      const basicIndexes = [
        'CREATE INDEX IF NOT EXISTS "idxLeadsCompanyId" ON cladbe_leads("companyId")',
        'CREATE INDEX IF NOT EXISTS "idxLeadsOwnerId" ON cladbe_leads("ownerId")',
        'CREATE INDEX IF NOT EXISTS "idxLeadsCreatedAt" ON cladbe_leads("createdAt")',
        'CREATE INDEX IF NOT EXISTS "idxLeadsEmailId" ON cladbe_leads("emailId")',
        'CREATE INDEX IF NOT EXISTS "idxLeadsMobileNumber" ON cladbe_leads("mobileNumber")',
        'CREATE INDEX IF NOT EXISTS "idxLeadsDeletedAt" ON cladbe_leads("deletedAt")',
        'CREATE INDEX IF NOT EXISTS "idxLeadsName" ON cladbe_leads("name")',
        'CREATE INDEX IF NOT EXISTS "idxLeadsCity" ON cladbe_leads("city")',
        'CREATE INDEX IF NOT EXISTS "idxLeadsCompanyEmail" ON cladbe_leads("companyId", "emailId")',
        'CREATE INDEX IF NOT EXISTS "idxAuditLeadId" ON lead_audit_logs("leadId")',
        'CREATE INDEX IF NOT EXISTS "idxAuditCompanyId" ON lead_audit_logs("companyId")',
        'CREATE INDEX IF NOT EXISTS "idxAuditAction" ON lead_audit_logs("action")',
        'CREATE INDEX IF NOT EXISTS "idxAuditActionAt" ON lead_audit_logs("actionAt")',
      ];

      for (const indexQuery of basicIndexes) {
        await client.query(indexQuery);
      }

      // Create trigram indexes with camelCase names
      const trigramIndexes = [
        'CREATE INDEX IF NOT EXISTS "idxLeadsNameTrgm" ON cladbe_leads USING gin ("name" gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS "idxLeadsCityTrgm" ON cladbe_leads USING gin ("city" gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS "idxLeadsEmailTrgm" ON cladbe_leads USING gin ("emailId" gin_trgm_ops)',
      ];

      for (const indexQuery of trigramIndexes) {
        await client.query(indexQuery);
      }

      // Create trigger for updating updatedAt with IST timestamp
      await client.query(`
          CREATE OR REPLACE FUNCTION "updateUpdatedAtColumn"()
          RETURNS TRIGGER AS $$
          BEGIN
            NEW."updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata');
            RETURN NEW;
          END;
          $$ language 'plpgsql';
        `);

      await client.query(`
          DROP TRIGGER IF EXISTS "updateLeadsUpdatedAt" ON cladbe_leads;
          CREATE TRIGGER "updateLeadsUpdatedAt"
          BEFORE UPDATE ON cladbe_leads
          FOR EACH ROW
          EXECUTE FUNCTION "updateUpdatedAtColumn"();
        `);

      await client.query("COMMIT");
      console.log(
        "Leads table and related objects created successfully with IST timestamps"
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to create leads table: ${error.message}`);
    } finally {
      client.release();
    }
  }

  async addSearchIndexes() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Set timezone to Asia/Kolkata (IST)
      await client.query("SET timezone = 'Asia/Kolkata'");

      // Create extension for full text search
      await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");

      // Create full text search indexes with camelCase names
      const searchIndexes = [
        'CREATE INDEX IF NOT EXISTS "idxLeadsNameSearch" ON cladbe_leads USING gin (to_tsvector(\'english\', "name"))',
        'CREATE INDEX IF NOT EXISTS "idxLeadsEmailSearch" ON cladbe_leads USING gin (to_tsvector(\'english\', "emailId"))',
        'CREATE INDEX IF NOT EXISTS "idxLeadsCitySearch" ON cladbe_leads USING gin (to_tsvector(\'english\', "city"))',
      ];

      for (const indexQuery of searchIndexes) {
        await client.query(indexQuery);
      }

      await client.query("COMMIT");
      console.log("Search indexes created successfully");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to create search indexes: ${error.message}`);
    } finally {
      client.release();
    }
  }

  async dropLeadsTable() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DROP TABLE IF EXISTS lead_audit_logs CASCADE");
      await client.query("DROP TABLE IF EXISTS cladbe_leads CASCADE");
      await client.query("COMMIT");
      console.log("Leads table and related objects dropped successfully");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to drop leads table: ${error.message}`);
    } finally {
      client.release();
    }
  }

  async truncateLeadsTable() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("TRUNCATE TABLE lead_audit_logs CASCADE");
      await client.query("TRUNCATE TABLE cladbe_leads CASCADE");
      await client.query("COMMIT");
      console.log("Leads table and related objects truncated successfully");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to truncate leads table: ${error.message}`);
    } finally {
      client.release();
    }
  }

  async checkTableExists(tableName) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public'
            AND table_name = $1
          );
        `,
        [tableName]
      );
      return result.rows[0].exists;
    } catch (error) {
      throw new Error(`Failed to check table existence: ${error.message}`);
    } finally {
      client.release();
    }
  }
}

module.exports = {
  TableHelper,
};
