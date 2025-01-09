const db = require("../db/connection");
const { AppError } = require("../utils/errorHandler");

class LeadSearchService {
  // Utility methods
  isValidLeadId(str) {
    const leadIdPattern = /^[a-zA-Z0-9-]+$/;
    return leadIdPattern.test(str);
  }

  async checkDuplicateMobile(mobileNumber, excludeLeadId = null) {
    const query = excludeLeadId
      ? {
          text: 'SELECT "leadId" FROM cladbeSearchLeads WHERE "mobileNumber" = $1 AND "leadId" != $2 AND "deletedAt" IS NULL',
          values: [mobileNumber, excludeLeadId],
        }
      : {
          text: 'SELECT "leadId" FROM cladbeSearchLeads WHERE "mobileNumber" = $1 AND "deletedAt" IS NULL',
          values: [mobileNumber],
        };

    const { rows } = await db.query(query);
    return rows.length > 0;
  }

  // Search Methods
  async searchByEmail(email, companyId) {
    const query = {
      text: `
        SELECT * FROM cladbeSearchLeads 
        WHERE "companyId" = $1 
        AND "emailId" ILIKE $2
        AND "deletedAt" IS NULL
      `,
      values: [companyId, `%${email}%`],
    };

    try {
      const { rows } = await db.query(query);
      return {
        results: rows,
        totalResults: rows.length,
        searchTerm: email,
      };
    } catch (error) {
      throw new AppError(`Email search failed: ${error.message}`, 500);
    }
  }

  async searchByName(name, companyId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = "name",
      orderDir = "ASC",
    } = options;

    try {
      const countQuery = {
        text: `
          SELECT COUNT(*) 
          FROM cladbeSearchLeads 
          WHERE "companyId" = $1 
          AND LOWER("name") LIKE LOWER($2)
          AND "deletedAt" IS NULL
        `,
        values: [companyId, `%${name}%`],
      };

      const {
        rows: [countResult],
      } = await db.query(countQuery);
      const totalResults = parseInt(countResult.count);

      const validColumns = ["name", "mobileNumber", "createdAt"];
      const sortColumn = validColumns.includes(orderBy)
        ? `"${orderBy}"`
        : '"name"';

      const query = {
        text: `
          SELECT * FROM cladbeSearchLeads 
          WHERE "companyId" = $1 
          AND LOWER("name") LIKE LOWER($2)
          AND "deletedAt" IS NULL
          ORDER BY ${sortColumn} ${orderDir}
          LIMIT $3 OFFSET $4
        `,
        values: [companyId, `%${name}%`, limit, offset],
      };

      const { rows } = await db.query(query);

      return {
        results: rows,
        pagination: {
          total: totalResults,
          limit,
          offset,
          hasMore: offset + rows.length < totalResults,
        },
        sorting: {
          column: orderBy,
          direction: orderDir,
        },
      };
    } catch (error) {
      throw new AppError(`Name search failed: ${error.message}`, 500);
    }
  }

  async searchByMobile(mobile, companyId) {
    try {
      const { rows } = await db.query(
        `
        SELECT * FROM cladbeSearchLeads 
        WHERE "companyId" = $1 
        AND "mobileNumber" LIKE $2
        AND "deletedAt" IS NULL
        `,
        [companyId, `%${mobile}%`]
      );

      return {
        results: rows,
        totalResults: rows.length,
        searchTerm: mobile,
      };
    } catch (error) {
      throw new AppError(`Mobile search failed: ${error.message}`, 500);
    }
  }

  async universalSearch(searchParams) {
    const {
      searchTerm,
      companyId,
      agentId,
      limit = 50,
      offset = 0,
      orderBy = "name",
      orderDir = "ASC",
    } = searchParams;

    try {
      if (!searchTerm || !companyId) {
        throw new AppError("Search term and Company ID are required", 400);
      }

      const validOrderColumns = ["name", "mobileNumber", "createdAt"];
      const sortColumn = validOrderColumns.includes(orderBy)
        ? `"${orderBy}"`
        : '"name"';
      const sortDirection = orderDir?.toUpperCase() === "DESC" ? "DESC" : "ASC";

      let countQuery, query, bindParams;

      if (agentId) {
        countQuery = `
          SELECT COUNT(*) as total
          FROM cladbeSearchLeads
          WHERE "companyId" = $1
          AND "deletedAt" IS NULL
          AND (
            "ownerId" = $2
            OR "coOwnerIds" @> ARRAY[$2]::text[]
          )
          AND (
            LOWER("emailId") LIKE LOWER($3)
            OR LOWER("name") LIKE LOWER($3)
            OR LOWER("mobileNumber") LIKE LOWER($3)
            OR LOWER("city") LIKE LOWER($3)
          )
        `;

        query = `
          SELECT * FROM cladbeSearchLeads
          WHERE "companyId" = $1
          AND "deletedAt" IS NULL
          AND (
            "ownerId" = $2
            OR "coOwnerIds" @> ARRAY[$2]::text[]
          )
          AND (
            LOWER("emailId") LIKE LOWER($3)
            OR LOWER("name") LIKE LOWER($3)
            OR LOWER("mobileNumber") LIKE LOWER($3)
            OR LOWER("city") LIKE LOWER($3)
          )
          ORDER BY ${sortColumn} ${sortDirection}
          LIMIT $4 OFFSET $5
        `;

        bindParams = [companyId, agentId, `%${searchTerm}%`];
      } else {
        countQuery = `
          SELECT COUNT(*) as total
          FROM cladbeSearchLeads
          WHERE "companyId" = $1
          AND "deletedAt" IS NULL
          AND (
            LOWER("emailId") LIKE LOWER($2)
            OR LOWER("name") LIKE LOWER($2)
            OR LOWER("mobileNumber") LIKE LOWER($2)
            OR LOWER("city") LIKE LOWER($2)
          )
        `;

        query = `
          SELECT * FROM cladbeSearchLeads
          WHERE "companyId" = $1
          AND "deletedAt" IS NULL
          AND (
            LOWER("emailId") LIKE LOWER($2)
            OR LOWER("name") LIKE LOWER($2)
            OR LOWER("mobileNumber") LIKE LOWER($2)
            OR LOWER("city") LIKE LOWER($2)
          )
          ORDER BY ${sortColumn} ${sortDirection}
          LIMIT $3 OFFSET $4
        `;

        bindParams = [companyId, `%${searchTerm}%`];
      }

      const {
        rows: [countResult],
      } = await db.query(countQuery, [...bindParams]);
      const totalResults = parseInt(countResult.total || "0");

      const { rows: results } = await db.query(query, [
        ...bindParams,
        limit,
        offset,
      ]);

      return {
        results,
        pagination: {
          total: totalResults,
          limit,
          offset,
          hasMore: offset + results.length < totalResults,
        },
        sorting: {
          column: orderBy,
          direction: sortDirection,
        },
        searchTerm,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Universal search failed: ${error.message}`, 500);
    }
  }

  async createLead(leadData) {
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      if (!this.isValidLeadId(leadData.leadId)) {
        throw new AppError(
          "Lead ID can only contain letters, numbers, and hyphens",
          400
        );
      }

      const isDuplicateMobile = await this.checkDuplicateMobile(
        leadData.mobileNumber
      );
      if (isDuplicateMobile) {
        throw new AppError("Mobile number already exists", 409);
      }

      const result = await client.query(
        `
        INSERT INTO cladbeSearchLeads (
          "leadId", "companyId", "ownerId", "coOwnerIds",
          "mobileNumber", "emailId", "name", "city",
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
        )
        RETURNING *
        `,
        [
          leadData.leadId,
          leadData.companyId,
          leadData.ownerId,
          leadData.coOwnerIds || [],
          leadData.mobileNumber,
          leadData.emailId?.toLowerCase(),
          leadData.name,
          leadData.city,
        ]
      );

      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        if (error.constraint?.includes("leadId")) {
          throw new AppError("Lead ID already exists", 409);
        }
        if (error.constraint?.includes("mobileNumber")) {
          throw new AppError("Mobile number already exists", 409);
        }
      }
      throw new AppError(`Failed to create lead: ${error.message}`, 500);
    } finally {
      client.release();
    }
  }

  async updateLead(leadId, companyId, updateData) {
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      const existingLead = await client.query(
        `SELECT * FROM cladbeSearchLeads WHERE "leadId" = $1 AND "companyId" = $2 AND "deletedAt" IS NULL`,
        [leadId, companyId]
      );

      if (existingLead.rows.length === 0) {
        throw new AppError("Lead not found", 404);
      }

      if (
        updateData.mobileNumber &&
        updateData.mobileNumber !== existingLead.rows[0].mobileNumber
      ) {
        const isDuplicateMobile = await this.checkDuplicateMobile(
          updateData.mobileNumber,
          leadId
        );
        if (isDuplicateMobile) {
          throw new AppError("Mobile number already exists", 409);
        }
      }

      const setValues = [];
      const values = [leadId, companyId];
      let paramCount = 3;

      Object.entries(updateData).forEach(([key, value]) => {
        if (
          value !== undefined &&
          !["leadId", "companyId", "createdAt"].includes(key)
        ) {
          setValues.push(`"${key}" = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      if (setValues.length === 0) {
        throw new AppError("No valid fields to update", 400);
      }

      const result = await client.query(
        `
        UPDATE cladbeSearchLeads
        SET ${setValues.join(
          ", "
        )}, "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
        WHERE "leadId" = $1 AND "companyId" = $2
        RETURNING *
        `,
        values
      );

      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw new AppError(
        `Failed to update lead: ${error.message}`,
        error.code === "23505" ? 409 : 500
      );
    } finally {
      client.release();
    }
  }

  async deleteLead(leadId, companyId) {
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
        UPDATE cladbeSearchLeads
        SET "deletedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
            "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
        WHERE "leadId" = $1 
        AND "companyId" = $2
        AND "deletedAt" IS NULL
        RETURNING *
        `,
        [leadId, companyId]
      );

      if (result.rows.length === 0) {
        throw new AppError("Lead not found or already deleted", 404);
      }

      await client.query("COMMIT");
      return {
        message: "Lead deleted successfully",
        deletedAt: result.rows[0].deletedAt,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw new AppError(`Failed to delete lead: ${error.message}`, 500);
    } finally {
      client.release();
    }
  }

  async getLeadsByAgent(params) {
    const {
      agentId,
      companyId,
      status,
      limit = 50,
      offset = 0,
      orderBy = "createdAt",
      orderDir = "DESC",
    } = params;

    try {
      let query = `
        WITH agent_leads AS (
          SELECT *,
            CASE 
              WHEN "ownerId" = $1 THEN 'owner'
              WHEN "coOwnerIds" @> ARRAY[$1]::text[] THEN 'coOwner'
              ELSE 'none'
            END as role
          FROM cladbeSearchLeads
          WHERE "companyId" = $2
          AND "deletedAt" IS NULL
          AND (
            "ownerId" = $1
            OR "coOwnerIds" @> ARRAY[$1]::text[]
          )
      `;

      const values = [agentId, companyId];
      let paramCount = 3;

      if (status) {
        query += ` AND "status" = $${paramCount}`;
        values.push(status);
        paramCount++;
      }

      query += `
        )
        SELECT 
          *,
          COUNT(*) OVER() as total_count
        FROM agent_leads
        ORDER BY "${orderBy}" ${orderDir}
        LIMIT ${paramCount} OFFSET ${paramCount + 1}
      `;

      // Continuing the getLeadsByAgent method...
      values.push(limit, offset);

      const { rows } = await db.query(query, values);
      const totalCount = rows.length > 0 ? parseInt(rows[0].total_count) : 0;

      const results = {
        owner: rows.filter((row) => row.role === "owner"),
        coOwner: rows.filter((row) => row.role === "coOwner"),
      };

      return {
        results,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + rows.length < totalCount,
        },
        summary: {
          totalAsOwner: results.owner.length,
          totalAsCoOwner: results.coOwner.length,
        },
      };
    } catch (error) {
      throw new AppError(`Failed to fetch agent leads: ${error.message}`, 500);
    }
  }

  async adminUpdateLead(leadId, updateData) {
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      const existingLead = await client.query(
        'SELECT * FROM cladbeSearchLeads WHERE "leadId" = $1',
        [leadId]
      );

      if (existingLead.rows.length === 0) {
        throw new AppError("Lead not found", 404);
      }

      if (
        updateData.mobileNumber &&
        updateData.mobileNumber !== existingLead.rows[0].mobileNumber
      ) {
        const isDuplicateMobile = await this.checkDuplicateMobile(
          updateData.mobileNumber,
          leadId
        );
        if (isDuplicateMobile) {
          throw new AppError("Mobile number already exists", 409);
        }
      }

      const setValues = [];
      const values = [leadId];
      let paramCount = 2;

      Object.entries(updateData).forEach(([key, value]) => {
        if (value !== undefined && !["leadId", "createdAt"].includes(key)) {
          setValues.push(`"${key}" = ${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      const result = await client.query(
        `
      UPDATE cladbeSearchLeads
      SET ${setValues.join(", ")}, 
          "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
          "lastModifiedBy" = 'admin'
      WHERE "leadId" = $1
      RETURNING *
      `,
        values
      );

      // Add audit log
      await client.query(
        `
      INSERT INTO lead_audit_logs (
        "leadId", "action", "actionBy", "previousData", "newData", "actionAt"
      ) VALUES ($1, $2, $3, $4, $5, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))
      `,
        [
          leadId,
          "ADMIN_UPDATE",
          "admin",
          JSON.stringify(existingLead.rows[0]),
          JSON.stringify(result.rows[0]),
        ]
      );

      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw new AppError(
        `Failed to update lead: ${error.message}`,
        error.code === "23505" ? 409 : 500
      );
    } finally {
      client.release();
    }
  }

  async adminDeleteLead(leadId) {
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      const existingLead = await client.query(
        'SELECT * FROM cladbeSearchLeads WHERE "leadId" = $1',
        [leadId]
      );

      if (existingLead.rows.length === 0) {
        throw new AppError("Lead not found", 404);
      }

      const result = await client.query(
        `
      DELETE FROM cladbeSearchLeads
      WHERE "leadId" = $1
      RETURNING *
      `,
        [leadId]
      );

      // Add audit log
      await client.query(
        `
      INSERT INTO lead_audit_logs (
        "leadId", "action", "actionBy", "previousData", "actionAt"
      ) VALUES ($1, $2, $3, $4, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))
      `,
        [leadId, "ADMIN_DELETE", "admin", JSON.stringify(existingLead.rows[0])]
      );

      await client.query("COMMIT");
      return {
        message: "Lead permanently deleted",
        deletedLead: result.rows[0],
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw new AppError(`Failed to delete lead: ${error.message}`, 500);
    } finally {
      client.release();
    }
  }

  async adminGetAllLeads(options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = "createdAt",
      orderDir = "DESC",
    } = options;

    try {
      const query = {
        text: `
        SELECT *, COUNT(*) OVER() as total_count 
        FROM cladbeSearchLeads
        ORDER BY "${orderBy}" ${orderDir}
        LIMIT $1 OFFSET $2
      `,
        values: [limit, offset],
      };

      const { rows } = await db.query(query);
      const totalCount = rows.length > 0 ? parseInt(rows[0].total_count) : 0;

      return {
        results: rows,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + rows.length < totalCount,
        },
      };
    } catch (error) {
      throw new AppError(`Failed to fetch all leads: ${error.message}`, 500);
    }
  }

  async adminGetLeadById(leadId) {
    try {
      const { rows } = await db.query(
        'SELECT * FROM cladbeSearchLeads WHERE "leadId" = $1',
        [leadId]
      );

      if (rows.length === 0) {
        throw new AppError("Lead not found", 404);
      }

      return rows[0];
    } catch (error) {
      throw new AppError(`Failed to fetch lead: ${error.message}`, 500);
    }
  }
}

module.exports = LeadSearchService;
