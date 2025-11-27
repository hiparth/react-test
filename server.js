const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Basic health check that doesn't require Databricks connection
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Databricks connection configuration
// Supports both PAT (Personal Access Token) and OAuth (Client Credentials)
const databricksConfig = {
  serverHostname: process.env.DATABRICKS_HOST,
  httpPath: process.env.DATABRICKS_HTTP_PATH,
  accessToken: process.env.DATABRICKS_ACCESS_TOKEN,
  clientId: process.env.DATABRICKS_CLIENT_ID,
  clientSecret: process.env.DATABRICKS_CLIENT_SECRET,
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
    // Use OAuth if client credentials are available, otherwise use PAT
    const connectOptions = {
      host: databricksConfig.serverHostname,
      path: databricksConfig.httpPath,
    };

    if (databricksConfig.clientId && databricksConfig.clientSecret) {
      // OAuth authentication
      connectOptions.authType = 'databricks-oauth';
      connectOptions.oauthClientId = databricksConfig.clientId;
      connectOptions.oauthClientSecret = databricksConfig.clientSecret;
    } else if (databricksConfig.accessToken) {
      // PAT authentication
      connectOptions.token = databricksConfig.accessToken;
    } else {
      throw new Error('No authentication method configured. Provide either PAT (DATABRICKS_ACCESS_TOKEN) or OAuth (DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET)');
    }

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
    const missingConfig = [];
    if (!databricksConfig.serverHostname) missingConfig.push('DATABRICKS_HOST');
    if (!databricksConfig.httpPath) missingConfig.push('DATABRICKS_HTTP_PATH');
    
    // Check for authentication (either PAT or OAuth)
    const hasPAT = !!databricksConfig.accessToken;
    const hasOAuth = !!(databricksConfig.clientId && databricksConfig.clientSecret);
    
    if (!hasPAT && !hasOAuth) {
      missingConfig.push('DATABRICKS_ACCESS_TOKEN (or DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET)');
    }
    
    if (missingConfig.length > 0) {
      return res.status(500).json({ 
        error: 'Databricks configuration is missing.',
        details: `Missing environment variables: ${missingConfig.join(', ')}`,
        instructions: 'Please set these environment variables in your app.yaml file or Databricks App configuration.'
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
    clientId: !!databricksConfig.clientId,
    clientSecret: !!databricksConfig.clientSecret,
    authMethod: (databricksConfig.clientId && databricksConfig.clientSecret) ? 'OAuth' : (databricksConfig.accessToken ? 'PAT' : 'None'),
  };
  
  const missing = [];
  if (!configStatus.serverHostname) missing.push('DATABRICKS_HOST');
  if (!configStatus.httpPath) missing.push('DATABRICKS_HTTP_PATH');
  if (!configStatus.accessToken && !configStatus.clientId) {
    missing.push('DATABRICKS_ACCESS_TOKEN or DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET');
  }
  
  const isConfigured = configStatus.serverHostname && configStatus.httpPath && configStatus.authMethod !== 'None';
  
  res.json({ 
    status: missing.length > 0 ? 'configuration_incomplete' : 'ok',
    databricksConfigured: isConfigured,
    configStatus,
    missingVariables: missing,
    environment: process.env.NODE_ENV || 'development',
    instructions: missing.length > 0 ? 'Set the missing environment variables in app.yaml or Databricks App settings. See DEPLOYMENT.md for details.' : null
  });
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the app at: http://0.0.0.0:${PORT}`);
  console.log('\nConfiguration Status:');
    console.log(`  - Server Hostname: ${databricksConfig.serverHostname ? '✓ Set' : '✗ Missing'}`);
    console.log(`  - HTTP Path: ${databricksConfig.httpPath ? '✓ Set' : '✗ Missing'}`);
    
    const authMethod = (databricksConfig.clientId && databricksConfig.clientSecret) ? 'OAuth' : (databricksConfig.accessToken ? 'PAT' : 'None');
    console.log(`  - Auth Method: ${authMethod}`);
    if (authMethod === 'OAuth') {
      console.log(`  - Client ID: ${databricksConfig.clientId ? '✓ Set' : '✗ Missing'}`);
      console.log(`  - Client Secret: ${databricksConfig.clientSecret ? '✓ Set' : '✗ Missing'}`);
    } else if (authMethod === 'PAT') {
      console.log(`  - Access Token: ${databricksConfig.accessToken ? '✓ Set' : '✗ Missing'}`);
    }
    
    if (!databricksConfig.serverHostname || !databricksConfig.httpPath || authMethod === 'None') {
      console.log('\n⚠️  WARNING: Databricks configuration is incomplete.');
      console.log('   Set environment variables:');
      console.log('   - DATABRICKS_HOST');
      console.log('   - DATABRICKS_HTTP_PATH');
      console.log('   - DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET (OAuth)');
      console.log('   - OR DATABRICKS_ACCESS_TOKEN (PAT)');
    }
  
  if (!DBSQLClient) {
    console.warn('\n⚠️  WARNING: Databricks SQL client not loaded. Please install @databricks/sql package.');
  }
}).on('error', (err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});

