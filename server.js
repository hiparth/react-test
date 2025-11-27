const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/', limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit

// Basic health check that doesn't require Databricks connection
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Databricks connection configuration
// Configuration can be set via environment variables or Databricks secrets
// When deployed on Databricks, use the Databricks UI to set environment variables
const databricksConfig = {
  serverHostname: process.env.DATABRICKS_HOST || 'dbc-0425a584-f749.cloud.databricks.com',
  httpPath: process.env.DATABRICKS_HTTP_PATH || '/sql/1.0/warehouses/384c984e5512b065',
  accessToken: process.env.DATABRICKS_ACCESS_TOKEN || 'dapi53b32a2a4e9f9f66b90fbc357846063d',
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
    const missingConfig = [];
    if (!databricksConfig.serverHostname) missingConfig.push('DATABRICKS_HOST');
    if (!databricksConfig.httpPath) missingConfig.push('DATABRICKS_HTTP_PATH');
    if (!databricksConfig.accessToken) missingConfig.push('DATABRICKS_ACCESS_TOKEN');
    
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
  };
  
  const missing = [];
  if (!configStatus.serverHostname) missing.push('DATABRICKS_HOST');
  if (!configStatus.httpPath) missing.push('DATABRICKS_HTTP_PATH');
  if (!configStatus.accessToken) missing.push('DATABRICKS_ACCESS_TOKEN');
  
  res.json({ 
    status: missing.length > 0 ? 'configuration_incomplete' : 'ok',
    databricksConfigured: Object.values(configStatus).every(v => v),
    configStatus,
    missingVariables: missing,
    environment: process.env.NODE_ENV || 'development',
    instructions: missing.length > 0 ? 'Set the missing environment variables in app.yaml or Databricks App settings. See DEPLOYMENT.md for details.' : null
  });
});

// Upload file to Databricks volume
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const volumePath = '/Volumes/kna_prd_ds/sales_exec/bid_opt';
    const targetPath = `${volumePath}/${fileName}`;

    // Read file
    const fileBuffer = fs.readFileSync(filePath);
    const fileBase64 = fileBuffer.toString('base64');

    // Upload to Databricks volume using REST API
    const databricksUrl = `https://${databricksConfig.serverHostname}`;
    const uploadUrl = `${databricksUrl}/api/2.0/volumes/upload`;
    
    try {
      const response = await axios.post(uploadUrl, {
        file_path: targetPath,
        contents: fileBase64,
        overwrite: true
      }, {
        headers: {
          'Authorization': `Bearer ${databricksConfig.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      // Clean up local file
      fs.unlinkSync(filePath);

      res.json({ 
        success: true, 
        message: `File uploaded successfully to ${targetPath}`,
        path: targetPath
      });
    } catch (error) {
      // Clean up local file on error
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      console.error('Databricks upload error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || error.response?.data?.error || 'Failed to upload file to Databricks');
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to upload file'
    });
  }
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
    console.log(`  - Access Token: ${databricksConfig.accessToken ? '✓ Set' : '✗ Missing'}`);
    
    if (!databricksConfig.serverHostname || !databricksConfig.httpPath || !databricksConfig.accessToken) {
      console.log('\n⚠️  WARNING: Databricks configuration is incomplete.');
      console.log('   Set environment variables:');
      console.log('   - DATABRICKS_HOST');
      console.log('   - DATABRICKS_HTTP_PATH');
      console.log('   - DATABRICKS_ACCESS_TOKEN');
    }
  
  if (!DBSQLClient) {
    console.warn('\n⚠️  WARNING: Databricks SQL client not loaded. Please install @databricks/sql package.');
  }
}).on('error', (err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});

