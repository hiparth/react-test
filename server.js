const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Databricks connection configuration
const databricksConfig = {
  serverHostname: process.env.DATABRICKS_SERVER_HOSTNAME,
  httpPath: process.env.DATABRICKS_HTTP_PATH,
  accessToken: process.env.DATABRICKS_ACCESS_TOKEN,
};

// Initialize Databricks SQL client
let DBSQLClient;
try {
  DBSQLClient = require('@databricks/sql').DBSQLClient;
} catch (error) {
  console.error('Error loading Databricks SQL client:', error.message);
  console.log('Note: Make sure @databricks/sql is installed');
}

// Helper function to execute SQL query
async function executeQuery(query) {
  if (!DBSQLClient) {
    throw new Error('Databricks SQL client not available');
  }

  const client = new DBSQLClient();
  
  try {
    const connectOptions = {
      token: databricksConfig.accessToken,
      host: databricksConfig.serverHostname,
      path: databricksConfig.httpPath,
    };

    await client.connect(connectOptions);
    const session = await client.openSession();
    
    try {
      const operation = await session.executeStatement(query, { runAsync: true });
      const result = await operation.fetchAll();
      const schema = await operation.getSchema();
      
      // Extract column names from schema
      const columns = schema && schema.columns 
        ? schema.columns.map(col => col.columnName)
        : (result.length > 0 ? Object.keys(result[0]) : []);

      await operation.close();
      
      return {
        columns: columns,
        rows: result,
        rowCount: result.length
      };
    } finally {
      await session.close();
    }
  } finally {
    await client.close();
  }
}

// API endpoint to execute SQL queries
app.post('/api/query', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ 
        error: 'Please provide a valid SQL query' 
      });
    }

    // Validate Databricks configuration
    if (!databricksConfig.serverHostname || !databricksConfig.httpPath || !databricksConfig.accessToken) {
      return res.status(500).json({ 
        error: 'Databricks configuration is missing. Please check your environment variables.' 
      });
    }

    const result = await executeQuery(query);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Query execution error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to execute query',
      details: error.toString()
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const configStatus = {
    serverHostname: !!databricksConfig.serverHostname,
    httpPath: !!databricksConfig.httpPath,
    accessToken: !!databricksConfig.accessToken,
  };
  
  res.json({ 
    status: 'ok', 
    databricksConfigured: Object.values(configStatus).every(v => v),
    configStatus 
  });
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Make sure to set DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH, and DATABRICKS_ACCESS_TOKEN in your .env file');
  if (!DBSQLClient) {
    console.warn('WARNING: Databricks SQL client not loaded. Please install @databricks/sql package.');
  }
});

