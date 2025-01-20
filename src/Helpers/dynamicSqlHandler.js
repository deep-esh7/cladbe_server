// dynamicSqlHandler.js

const DynamicTableHandler = require('./dynamicTableHandler.js');

async function handleSqlExecution(req, res) {
  const { query, parameters } = req.body;
  const sqlHelper = req.app.get('sqlHelper');
  const tableHandler = new DynamicTableHandler(sqlHelper);

  try {
    // Check if it's an INSERT query
    if (query.trim().toUpperCase().startsWith('INSERT')) {
      try {
        // Check if table exists
        const { tableName } = tableHandler.parseInsertQuery(query, parameters);
        const tableExists = await sqlHelper.executeQuery(
          'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)',
          ['public', tableName]
        );

        // Create table if it doesn't exist
        if (!tableExists[0].exists) {
          console.log(`Table ${tableName} does not exist, creating...`);
          await tableHandler.createTableFromQuery(query, parameters);
        }
      } catch (error) {
        console.error('Error handling table creation:', error);
        throw error;
      }
    }

    // Execute the original query
    const result = await sqlHelper.executeQuery(query, parameters);
    res.json({ 
      success: true, 
      data: result 
    });
    
  } catch (error) {
    console.error('SQL execution error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
}

module.exports = { handleSqlExecution };