#!/bin/bash

# Databricks Deployment Script
# This script helps prepare and deploy the SQL Query App to Databricks

set -e

echo "🚀 Databricks SQL Query App - Deployment Script"
echo "================================================"
echo ""

# Check if required tools are installed
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not installed. Aborting." >&2; exit 1; }

echo "✓ Node.js and npm are installed"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production
echo "✓ Dependencies installed"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found"
    echo "   Creating .env from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "   Please edit .env and add your Databricks credentials"
    else
        echo "   .env.example not found. Please create .env manually"
    fi
    echo ""
fi

# Create deployment package
echo "📦 Creating deployment package..."
tar -czf databricks-sql-app.tar.gz \
    server.js \
    package.json \
    app.yaml \
    public/ \
    .gitignore \
    README.md \
    DEPLOYMENT.md \
    --exclude=node_modules \
    --exclude=.env \
    --exclude=*.log

echo "✓ Deployment package created: databricks-sql-app.tar.gz"
echo ""

# Display next steps
echo "📋 Next Steps:"
echo "=============="
echo ""
echo "1. Upload the following to your Databricks workspace:"
echo "   - databricks-sql-app.tar.gz (extract it in your workspace)"
echo "   - Or upload individual files to a folder in your workspace"
echo ""
echo "2. In Databricks, set environment variables:"
echo "   - DATABRICKS_SERVER_HOSTNAME"
echo "   - DATABRICKS_HTTP_PATH"
echo "   - DATABRICKS_ACCESS_TOKEN"
echo ""
echo "3. Install dependencies in Databricks:"
echo "   cd /path/to/your/app"
echo "   npm install"
echo ""
echo "4. Run the application:"
echo "   node server.js"
echo ""
echo "For detailed instructions, see DEPLOYMENT.md"
echo ""
echo "✅ Deployment package ready!"

