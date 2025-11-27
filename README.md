# Databricks SQL Query Tool

A simple Node.js web application that allows you to execute SQL queries against Databricks and view the results in a user-friendly interface.

## Features

- 🎨 Modern, responsive UI
- 🔍 Execute SQL queries against Databricks
- 📊 Display query results in a formatted table
- ✅ Connection status indicator
- ⚡ Fast and lightweight

## Prerequisites

- Node.js (v14 or higher)
- A Databricks workspace with SQL Warehouse access
- Databricks Personal Access Token

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Databricks connection:**
   
   Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your Databricks credentials:
   - **DATABRICKS_SERVER_HOSTNAME**: Your Databricks server hostname (e.g., `adb-1234567890123456.7.azuredatabricks.net`)
   - **DATABRICKS_HTTP_PATH**: Your SQL Warehouse HTTP path (e.g., `/sql/1.0/warehouses/abc123def456`)
     - Find this in: Databricks Workspace → SQL Warehouses → Your Warehouse → Connection Details → HTTP Path
   - **DATABRICKS_ACCESS_TOKEN**: Your Personal Access Token
     - Generate from: User Settings → Access Tokens → Generate New Token

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open your browser:**
   Navigate to `http://localhost:3000`

## Usage

1. Enter your SQL query in the text box
2. Click "Execute Query" or press `Ctrl+Enter`
3. View results in the formatted table below
4. Use "Clear" to reset the query box

## Deployment on Databricks

**📖 For detailed deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md)**

### Quick Deploy

1. **Prepare deployment package:**
   ```bash
   # Linux/Mac
   ./deploy.sh
   
   # Windows
   .\deploy.ps1
   ```

2. **Upload to Databricks:**
   - Upload the generated package or files to your Databricks workspace
   - Extract files to a folder in your workspace

3. **Configure environment variables in Databricks:**
   - `DATABRICKS_SERVER_HOSTNAME`
   - `DATABRICKS_HTTP_PATH`
   - `DATABRICKS_ACCESS_TOKEN`

4. **Install and run:**
   ```bash
   npm install
   node server.js
   ```

### Deployment Methods

- **Databricks Apps** (Recommended) - Deploy as a custom app in your workspace
- **Databricks Jobs** - Run as a scheduled or on-demand job
- **Databricks Compute Cluster** - Run on a cluster with web terminal access
- **Container Services** - Deploy as a containerized application

See [DEPLOYMENT.md](./DEPLOYMENT.md) for step-by-step instructions for each method.

## Important Notes

- The application uses the official Databricks SQL Driver for Node.js (`@databricks/sql`)
- Ensure your SQL Warehouse is running before executing queries
- For production deployments, consider adding authentication and rate limiting
- The environment variable name is `DATABRICKS_ACCESS_TOKEN` (not `DATABRICKS_TOKEN`)

## Troubleshooting

**Connection Issues:**
- Verify your `.env` file has correct values
- Check that your SQL Warehouse is running
- Ensure your access token has proper permissions

**Query Errors:**
- Verify your SQL syntax is correct
- Check table/schema names exist in your Databricks workspace
- Ensure you have proper permissions to access the data

## License

ISC

