const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for memory storage (no disk writes)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Basic health check that doesn't require Databricks connection
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/assets', express.static('assets'));
app.use('/fonts', express.static('fonts'));

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

    const fileName = req.file.originalname;
    const fileBuffer = req.file.buffer;
    
    // Validate file extension - must be CSV
    const fileExtension = path.extname(fileName).toLowerCase();
    if (fileExtension !== '.csv') {
      return res.status(400).json({ error: 'File must be a CSV file (.csv extension required)' });
    }

    // Validate CSV has 'retailer' column
    try {
      const hasRetailerColumn = await new Promise((resolve, reject) => {
        const stream = Readable.from(fileBuffer);
        let headers = null;
        let firstRowRead = false;
        
        stream
          .pipe(csv())
          .on('data', (row) => {
            if (!firstRowRead) {
              // Get headers from first row keys
              headers = Object.keys(row);
              firstRowRead = true;
              stream.destroy(); // Stop reading after getting headers
              resolve(headers.includes('retailer'));
            }
          })
          .on('error', (error) => {
            reject(error);
          })
          .on('end', () => {
            if (!firstRowRead) {
              resolve(false);
            }
          });
      });

      if (!hasRetailerColumn) {
        return res.status(400).json({ error: 'CSV file must contain a column named "retailer"' });
      }
    } catch (csvError) {
      return res.status(400).json({ error: 'Invalid CSV file format: ' + csvError.message });
    }

    const volumePath = '/Volumes/kna_prd_ds/sales_exec/bid_opt';
    const targetPath = `${volumePath}/${fileName}`;

    // Upload to Databricks volume using Files API
    // API contract: /api/2.0/fs/files{file_path}
    const databricksUrl = `https://${databricksConfig.serverHostname}`;
    // Path should not be URL encoded, use raw path
    const uploadUrl = `${databricksUrl}/api/2.0/fs/files${targetPath}`;
    
    try {
      console.log('uploadUrl',uploadUrl);
      // Files API expects binary content in request body
      const response = await axios.put(uploadUrl, fileBuffer, {
        headers: {
          'Authorization': `Bearer ${databricksConfig.accessToken}`,
          'Content-Type': 'application/octet-stream'
        },
        params: {
          overwrite: 'true'
        }
      });

      res.json({ 
        success: true, 
        message: `File uploaded successfully to ${targetPath}`,
        path: targetPath
      });
    } catch (error) {
      console.error('Databricks upload error:', error.response?.data || error.message);
      const errorMsg = error.response?.data?.error?.message || 
                      error.response?.data?.error || 
                      error.response?.data?.message ||
                      error.message || 
                      'Failed to upload file to Databricks';
      throw new Error(errorMsg);
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to upload file'
    });
  }
});

// Serve the main page (query tool)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper function to parse week string to date
function parseWeekToDate(weekStr) {
  const parts = weekStr.replace('Wo ', '').split(' ');
  const monthMap = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
  return `${parts[2]}-${monthMap[parts[0]]}-${parts[1].padStart(2, '0')}`;
}

// Dashboard API endpoints
app.get('/api/dashboard/filters/retailers', async (req, res) => {
  try {
    const query = `SELECT DISTINCT account_name as retailer FROM kna_prd_ds.sales_exec.bid_opt_master_fact_historical ORDER BY retailer`;
    const result = await executeQuery(query);
    res.json({ success: true, data: result.rows.map(r => r.retailer) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/filters/campaigns', async (req, res) => {
  try {
    const { retailers, keywords, weeks } = req.query;
    const whereClauses = [];
    
    if (retailers && retailers !== 'all') {
      const retailerList = retailers.split(',').map(r => `'${r}'`).join(',');
      whereClauses.push(`account_name IN (${retailerList})`);
    }
    
    if (keywords && keywords !== 'all') {
      const keywordList = keywords.split(',').map(k => `'${k}'`).join(',');
      whereClauses.push(`keyword_id IN (${keywordList})`);
    }
    
    if (weeks && weeks !== 'all') {
      const weekList = weeks.split(',').map(w => {
        const date = parseWeekToDate(w);
        return `DATE_TRUNC('week', date) = CAST('${date}' AS DATE)`;
      }).join(' OR ');
      whereClauses.push(`(${weekList})`);
    }
    
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `
      SELECT DISTINCT 
        f.campaign_id, 
        COALESCE(d.campaign_name, CAST(f.campaign_id AS STRING)) as campaign_name
      FROM kna_prd_ds.sales_exec.bid_opt_master_fact_historical f
      LEFT JOIN kna_prd_ds.sales_exec.bid_opt_master_dim_historical d 
        ON f.campaign_id = d.campaign_id
      ${whereClause} 
      ORDER BY campaign_name, f.campaign_id
    `;
    const result = await executeQuery(query);
    console.log('Campaigns query result sample:', result.rows.slice(0, 3));
    res.json({ 
      success: true, 
      data: result.rows.map(r => {
        const campaignName = r.campaign_name || String(r.campaign_id);
        return {
          id: String(r.campaign_id),
          name: String(campaignName)
        };
      })
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/filters/keywords', async (req, res) => {
  try {
    const { retailers, campaigns, weeks } = req.query;
    const whereClauses = [];
    
    if (retailers && retailers !== 'all') {
      const retailerList = retailers.split(',').map(r => `'${r}'`).join(',');
      whereClauses.push(`account_name IN (${retailerList})`);
    }
    
    if (campaigns && campaigns !== 'all') {
      const campaignList = campaigns.split(',').map(c => `'${c}'`).join(',');
      whereClauses.push(`campaign_id IN (${campaignList})`);
    }
    
    if (weeks && weeks !== 'all') {
      const weekList = weeks.split(',').map(w => {
        const date = parseWeekToDate(w);
        return `DATE_TRUNC('week', date) = CAST('${date}' AS DATE)`;
      }).join(' OR ');
      whereClauses.push(`(${weekList})`);
    }
    
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `
      SELECT DISTINCT 
        f.keyword_id, 
        COALESCE(d.keyword, CAST(f.keyword_id AS STRING)) as keyword
      FROM kna_prd_ds.sales_exec.bid_opt_master_fact_historical f
      LEFT JOIN kna_prd_ds.sales_exec.bid_opt_master_dim_historical d 
        ON f.keyword_id = d.keyword_id
      ${whereClause} 
      ORDER BY keyword, f.keyword_id
    `;
    const result = await executeQuery(query);
    console.log('Keywords query result sample:', result.rows.slice(0, 3));
    res.json({ 
      success: true, 
      data: result.rows.map(r => {
        const keywordName = r.keyword || String(r.keyword_id);
        return {
          id: String(r.keyword_id),
          name: String(keywordName)
        };
      })
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/filters/weeks', async (req, res) => {
  try {
    const { retailers, campaigns, keywords } = req.query;
    const whereClauses = [];
    
    if (retailers && retailers !== 'all') {
      const retailerList = retailers.split(',').map(r => `'${r}'`).join(',');
      whereClauses.push(`account_name IN (${retailerList})`);
    }
    
    if (campaigns && campaigns !== 'all') {
      const campaignList = campaigns.split(',').map(c => `'${c}'`).join(',');
      whereClauses.push(`campaign_id IN (${campaignList})`);
    }
    
    if (keywords && keywords !== 'all') {
      const keywordList = keywords.split(',').map(k => `'${k}'`).join(',');
      whereClauses.push(`keyword_id IN (${keywordList})`);
    }
    
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `SELECT DISTINCT DATE_TRUNC('week', date) as week FROM kna_prd_ds.sales_exec.bid_opt_master_fact_historical ${whereClause} ORDER BY week DESC LIMIT 20`;
    const result = await executeQuery(query);
    res.json({ success: true, data: result.rows.map(r => r.week) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/data', async (req, res) => {
  try {
    const { retailers, campaigns, keywords, weeks } = req.query;
    const whereClauses = [];
    
    if (retailers && retailers !== 'all') {
      const retailerList = retailers.split(',').map(r => `'${r}'`).join(',');
      whereClauses.push(`account_name IN (${retailerList})`);
    }
    
    if (campaigns && campaigns !== 'all') {
      const campaignList = campaigns.split(',').map(c => `'${c}'`).join(',');
      whereClauses.push(`campaign_id IN (${campaignList})`);
    }
    
    if (keywords && keywords !== 'all') {
      const keywordList = keywords.split(',').map(k => `'${k}'`).join(',');
      whereClauses.push(`keyword_id IN (${keywordList})`);
    }
    
    if (weeks && weeks !== 'all') {
      const weekList = weeks.split(',').map(w => {
        const date = parseWeekToDate(w);
        return `DATE_TRUNC('week', date) = CAST('${date}' AS DATE)`;
      }).join(' OR ');
      whereClauses.push(`(${weekList})`);
    }
    
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    const query = `
      SELECT 
        DATE_TRUNC('week', date) as week,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(conversions) as conversions,
        SUM(cost) as spend,
        SUM(revenue) as sales_rev,
        AVG(avg_cpc) as cpc,
        AVG(avg_pos) as avg_rank,
        SUM(revenue) / NULLIF(SUM(cost), 0) as roas,
        SUM(clicks) / NULLIF(SUM(impressions), 0) as ctr,
        SUM(cost) / NULLIF(SUM(conversions), 0) as cpa,
        SUM(conversions) / NULLIF(SUM(clicks), 0) as conversion_rate
      FROM kna_prd_ds.sales_exec.bid_opt_master_fact_historical
      ${whereClause}
      GROUP BY week
      ORDER BY week
    `;
    
    const result = await executeQuery(query);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve dashboard page
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
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

