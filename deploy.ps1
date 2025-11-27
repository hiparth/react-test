# Databricks Deployment Script for Windows
# This script helps prepare and deploy the SQL Query App to Databricks

Write-Host "🚀 Databricks SQL Query App - Deployment Script" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js is installed: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is required but not installed. Aborting." -ForegroundColor Red
    exit 1
}

# Check if npm is installed
try {
    $npmVersion = npm --version
    Write-Host "✓ npm is installed: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ npm is required but not installed. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install --production
Write-Host "✓ Dependencies installed" -ForegroundColor Green
Write-Host ""

# Check if .env file exists
if (-not (Test-Path .env)) {
    Write-Host "⚠️  Warning: .env file not found" -ForegroundColor Yellow
    Write-Host "   Creating .env from .env.example..."
    if (Test-Path .env.example) {
        Copy-Item .env.example .env
        Write-Host "   Please edit .env and add your Databricks credentials" -ForegroundColor Yellow
    } else {
        Write-Host "   .env.example not found. Please create .env manually" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Create deployment package
Write-Host "📦 Creating deployment package..." -ForegroundColor Yellow

# Create a temporary directory for packaging
$tempDir = "deploy-temp"
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy necessary files
Copy-Item server.js $tempDir
Copy-Item package.json $tempDir
Copy-Item app.yaml $tempDir
Copy-Item .gitignore $tempDir
Copy-Item README.md $tempDir
Copy-Item DEPLOYMENT.md $tempDir
Copy-Item -Recurse public $tempDir

# Create tar.gz file (requires 7-Zip or tar command)
$packageName = "databricks-sql-app.tar.gz"
if (Get-Command tar -ErrorAction SilentlyContinue) {
    # Use tar if available (Windows 10+)
    Set-Location $tempDir
    tar -czf "../$packageName" *
    Set-Location ..
    Write-Host "✓ Deployment package created: $packageName" -ForegroundColor Green
} else {
    # Create zip file as alternative
    $zipName = "databricks-sql-app.zip"
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipName -Force
    Write-Host "✓ Deployment package created: $zipName" -ForegroundColor Green
    Write-Host "  (Note: tar.gz preferred, but zip created as alternative)" -ForegroundColor Yellow
}

# Cleanup
Remove-Item -Recurse -Force $tempDir

Write-Host ""

# Display next steps
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host "==============" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Upload the following to your Databricks workspace:"
Write-Host "   - databricks-sql-app.tar.gz (or .zip) - extract it in your workspace"
Write-Host "   - Or upload individual files to a folder in your workspace"
Write-Host ""
Write-Host "2. In Databricks, set environment variables:"
Write-Host "   - DATABRICKS_SERVER_HOSTNAME"
Write-Host "   - DATABRICKS_HTTP_PATH"
Write-Host "   - DATABRICKS_ACCESS_TOKEN"
Write-Host ""
Write-Host "3. Install dependencies in Databricks:"
Write-Host "   cd /path/to/your/app"
Write-Host "   npm install"
Write-Host ""
Write-Host "4. Run the application:"
Write-Host "   node server.js"
Write-Host ""
Write-Host "For detailed instructions, see DEPLOYMENT.md"
Write-Host ""
Write-Host "✅ Deployment package ready!" -ForegroundColor Green

