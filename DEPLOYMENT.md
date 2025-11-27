# Deployment Guide for Databricks

This guide walks you through deploying the SQL Query Tool on Databricks.

## Prerequisites

- A Databricks workspace with admin access
- A SQL Warehouse configured and running
- Node.js knowledge

## Method 1: Deploy as Databricks App (Recommended)

Databricks Apps allow you to deploy custom web applications directly in your workspace.

### Step 1: Prepare Your Application

1. **Package your application:**
   ```bash
   # Ensure all dependencies are installed
   npm install --production
   
   # Create a deployment package (optional, for manual upload)
   tar -czf databricks-sql-app.tar.gz .
   ```

### Step 2: Upload to Databricks Workspace

1. **Upload files to Databricks:**
   - Go to your Databricks workspace
   - Navigate to **Workspace** → **Users** → `your-username`
   - Create a new folder (e.g., `sql-query-app`)
   - Upload all project files:
     - `server.js`
     - `package.json`
     - `app.yaml`
     - `public/` folder (with `index.html`)
     - `.gitignore`

### Step 3: Configure Environment Variables

1. **Get your Databricks connection details:**
   - **Server Hostname**: Found in your SQL Warehouse connection details
     - Format: `adb-1234567890123456.7.azuredatabricks.net`
   - **HTTP Path**: Found in SQL Warehouse → Connection Details → HTTP Path
     - Format: `/sql/1.0/warehouses/abc123def456`
   - **Access Token**: Generate from User Settings → Access Tokens

2. **Set environment variables in Databricks:**
   - In the Databricks UI, navigate to your app configuration
   - Add environment variables:
     ```
     DATABRICKS_SERVER_HOSTNAME=your-server-hostname
     DATABRICKS_HTTP_PATH=your-http-path
     DATABRICKS_ACCESS_TOKEN=your-access-token
     PORT=3000
     ```

### Step 4: Install Dependencies

1. **Open a terminal in Databricks:**
   - Navigate to your app folder in the workspace
   - Open a terminal or notebook

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

### Step 5: Deploy and Run

1. **Using Databricks Apps (if available in your workspace):**
   - Go to **Compute** → **Apps**
   - Click **Create App**
   - Select your app folder
   - Configure the app using `app.yaml`
   - Deploy

2. **Alternative: Run as a Job:**
   - Create a new Databricks Job
   - Set the command to: `node server.js`
   - Configure environment variables in job settings
   - Run the job

## Method 2: Deploy Using Databricks Container Services

If your Databricks workspace supports container services:

1. **Create a Dockerfile:**
   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm install --production
   COPY . .
   EXPOSE 3000
   CMD ["node", "server.js"]
   ```

2. **Build and deploy the container** to your Databricks container service

## Method 3: Deploy on Databricks Compute Cluster

### Step 1: Create a Cluster

1. Go to **Compute** → **Clusters**
2. Create a new cluster with:
   - Runtime: Databricks Runtime (latest)
   - Node type: Standard (or as needed)

### Step 2: Upload Application

1. Upload your application files to DBFS or workspace
2. Use Databricks File System (DBFS) or workspace files

### Step 3: Run Application

1. **Option A: Using Databricks Notebook:**
   Create a notebook with:
   ```python
   # Install Node.js and dependencies
   %sh
   curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
   apt-get install -y nodejs
   cd /dbfs/path/to/your/app
   npm install
   node server.js
   ```

2. **Option B: Using Web Terminal:**
   - Enable web terminal on your cluster
   - SSH into the cluster
   - Navigate to your app directory
   - Run `npm install && node server.js`

### Step 4: Access the Application

- If running on a cluster, you may need to set up port forwarding
- Use Databricks proxy or configure network access
- Access via the cluster's web terminal URL or configured endpoint

## Configuration Using Databricks Secrets (Recommended for Production)

For better security, use Databricks Secrets instead of environment variables:

1. **Create a secret scope:**
   ```python
   # In a Databricks notebook
   dbutils.secrets.createScope("sql-app-secrets")
   ```

2. **Store secrets:**
   ```python
   # Note: Use Databricks CLI or UI to set secrets
   # CLI command:
   # databricks secrets put --scope sql-app-secrets --key server_hostname
   ```

3. **Update server.js** to read from secrets (optional enhancement)

## Troubleshooting

### app.yaml Format Errors

If you get "Error reading app.yaml file, please ensure it is in the correct format":

1. **Check YAML syntax:**
   - Use spaces (not tabs) for indentation
   - Ensure consistent 2-space indentation
   - Remove any trailing spaces

2. **Try minimal format:**
   If the current `app.yaml` doesn't work, try the minimal version:
   ```yaml
   command: ['node', 'server.js']
   ```
   (See `app.yaml.minimal` file)

3. **Alternative command format:**
   Some Databricks versions may require:
   ```yaml
   command: node server.js
   ```
   Instead of the array format.

4. **Remove env section:**
   If environment variables cause issues, remove the `env:` section and set variables in the Databricks UI instead.

5. **Validate YAML:**
   Use an online YAML validator to check syntax before deploying.

### Application Won't Start

- **Check Node.js version:** Ensure Node.js 14+ is installed
- **Verify dependencies:** Run `npm install` in the app directory
- **Check logs:** Review Databricks logs for error messages
- **Verify app.yaml:** Ensure the file is in the root directory and properly formatted

### Connection Issues

- **Verify SQL Warehouse is running:** Ensure your SQL Warehouse is active
- **Check credentials:** Verify environment variables are set correctly
- **Test connection:** Use the `/api/health` endpoint to check configuration

### Port Access Issues

- **Check firewall rules:** Ensure port 3000 (or your configured port) is accessible
- **Use Databricks proxy:** Configure Databricks to proxy requests to your app
- **Verify network settings:** Check cluster network configuration

## Accessing the Deployed Application

Once deployed, access your application:

- **Databricks Apps:** Access via the Apps section in Databricks UI
- **Cluster deployment:** Access via cluster web terminal or configured endpoint
- **Job deployment:** Access via job output or configured endpoint

## Security Best Practices

1. **Use Databricks Secrets** for sensitive credentials
2. **Enable authentication** if exposing publicly
3. **Use HTTPS** in production
4. **Implement rate limiting** for API endpoints
5. **Validate and sanitize** SQL queries to prevent injection

## Next Steps

- Monitor application logs in Databricks
- Set up alerts for errors
- Configure auto-scaling if needed
- Implement authentication for production use

