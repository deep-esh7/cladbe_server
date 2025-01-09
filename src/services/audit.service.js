const db = require("../db/connection");
const { AppError } = require("../utils/errorHandler");

class AuditService {
  async createAuditLog(params) {
    const {
      leadId,
      companyId,
      action,
      actionBy,
      previousData,
      newData,
      metadata = {},
    } = params;

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
        INSERT INTO lead_audit_logs (
          leadId,
          companyId,
          action,
          actionBy,
          previousData,
          newData,
          metadata,
          actionAt
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *
      `,
        [
          leadId,
          companyId,
          action,
          actionBy,
          previousData ? JSON.stringify(previousData) : null,
          newData ? JSON.stringify(newData) : null,
          JSON.stringify(metadata),
        ]
      );

      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw new AppError(`Failed to create audit log: ${error.message}`, 500);
    } finally {
      client.release();
    }
  }

  async getAuditLogs(params) {
    const {
      leadId,
      companyId,
      startDate,
      endDate,
      actions = [],
      actionBy,
      limit = 50,
      offset = 0,
      orderBy = "actionAt",
      orderDir = "DESC",
    } = params;

    try {
      let query = `
        SELECT 
          al.*,
          CASE 
            WHEN al.previousData IS NULL AND al.newData IS NOT NULL THEN 
              jsonb_object_keys(al.newData::jsonb)
            WHEN al.previousData IS NOT NULL AND al.newData IS NOT NULL THEN
              (
                SELECT array_agg(key)
                FROM jsonb_each_text(al.newData::jsonb) AS n(key, value)
                WHERE value != (al.previousData::jsonb ->> key)
              )
            ELSE NULL
          END as changed_fields
        FROM lead_audit_logs al
        WHERE 1=1
      `;

      const values = [];
      let paramCount = 1;

      if (leadId) {
        query += ` AND leadId = $${paramCount}`;
        values.push(leadId);
        paramCount++;
      }

      if (companyId) {
        query += ` AND companyId = $${paramCount}`;
        values.push(companyId);
        paramCount++;
      }

      if (startDate) {
        query += ` AND actionAt >= $${paramCount}`;
        values.push(startDate);
        paramCount++;
      }

      if (endDate) {
        query += ` AND actionAt <= $${paramCount}`;
        values.push(endDate);
        paramCount++;
      }

      if (actions.length > 0) {
        query += ` AND action = ANY($${paramCount}::text[])`;
        values.push(actions);
        paramCount++;
      }

      if (actionBy) {
        query += ` AND actionBy = $${paramCount}`;
        values.push(actionBy);
        paramCount++;
      }

      // Add ordering
      query += ` ORDER BY ${orderBy} ${orderDir}`;

      // Add pagination
      query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      values.push(limit, offset);

      const { rows } = await db.query(query, values);

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM lead_audit_logs
        WHERE leadId = $1
      `;

      const {
        rows: [countResult],
      } = await db.query(countQuery, [leadId]);
      const total = parseInt(countResult.total);

      return {
        logs: rows.map((row) => ({
          ...row,
          previousData: row.previousData ? JSON.parse(row.previousData) : null,
          newData: row.newData ? JSON.parse(row.newData) : null,
          metadata: row.metadata ? JSON.parse(row.metadata) : null,
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + rows.length < total,
        },
      };
    } catch (error) {
      throw new AppError(`Failed to fetch audit logs: ${error.message}`, 500);
    }
  }

  async getLeadHistory(leadId) {
    try {
      const query = `
        WITH timeline AS (
          -- Lead creation event
          SELECT 
            leadId,
            'CREATED' as event_type,
            createdAt as event_time,
            jsonb_build_object(
              'createdBy', ownerId,
              'initialData', to_jsonb(l.*)
            ) as event_data
          FROM cladbeSearchLeads l
          WHERE leadId = $1

          UNION ALL

          -- Lead updates
          SELECT 
            leadId,
            action as event_type,
            actionAt as event_time,
            jsonb_build_object(
              'actionBy', actionBy,
              'changes', jsonb_build_object(
                'from', previousData::jsonb,
                'to', newData::jsonb
              ),
              'metadata', metadata::jsonb
            ) as event_data
          FROM lead_audit_logs
          WHERE leadId = $1
        )
        SELECT *
        FROM timeline
        ORDER BY event_time DESC
      `;

      const { rows } = await db.query(query, [leadId]);

      return rows.map((row) => ({
        ...row,
        event_data: JSON.parse(row.event_data),
      }));
    } catch (error) {
      throw new AppError(`Failed to fetch lead history: ${error.message}`, 500);
    }
  }

  async getLeadChanges(leadId, startDate, endDate) {
    try {
      const query = `
        SELECT 
          al.*,
          jsonb_object_agg(
            key,
            jsonb_build_object(
              'old', previousData::jsonb ->> key,
              'new', newData::jsonb ->> key
            )
          ) as changes
        FROM lead_audit_logs al,
        jsonb_each_text(newData::jsonb) AS changes(key, value)
        WHERE leadId = $1
        AND actionAt BETWEEN $2 AND $3
        AND previousData IS NOT NULL
        AND previousData::jsonb ->> key != value
        GROUP BY al.id
        ORDER BY actionAt DESC
      `;

      const { rows } = await db.query(query, [leadId, startDate, endDate]);

      return rows.map((row) => ({
        ...row,
        changes: JSON.parse(row.changes),
      }));
    } catch (error) {
      throw new AppError(`Failed to fetch lead changes: ${error.message}`, 500);
    }
  }

  async getFieldHistory(params) {
    const { leadId, fieldName, limit = 50 } = params;

    try {
      const query = `
        WITH field_changes AS (
          SELECT
            actionAt,
            actionBy,
            action,
            previousData::jsonb ->> $2 as old_value,
            newData::jsonb ->> $2 as new_value
          FROM lead_audit_logs
          WHERE leadId = $1
          AND (
            (previousData::jsonb ->> $2) IS DISTINCT FROM (newData::jsonb ->> $2)
          )
          ORDER BY actionAt DESC
          LIMIT $3
        )
        SELECT * FROM field_changes
        WHERE old_value IS NOT NULL OR new_value IS NOT NULL
      `;

      const { rows } = await db.query(query, [leadId, fieldName, limit]);
      return rows;
    } catch (error) {
      throw new AppError(
        `Failed to fetch field history: ${error.message}`,
        500
      );
    }
  }

  async getAuditStats(companyId, startDate, endDate) {
    try {
      const query = `
        SELECT
          action,
          COUNT(*) as count,
          MIN(actionAt) as first_action,
          MAX(actionAt) as last_action,
          COUNT(DISTINCT actionBy) as unique_users,
          COUNT(DISTINCT leadId) as affected_leads
        FROM lead_audit_logs
        WHERE companyId = $1
        AND actionAt BETWEEN $2 AND $3
        GROUP BY action
        ORDER BY count DESC
      `;

      const { rows } = await db.query(query, [companyId, startDate, endDate]);
      return rows;
    } catch (error) {
      throw new AppError(`Failed to fetch audit stats: ${error.message}`, 500);
    }
  }
}

module.exports = new AuditService();
