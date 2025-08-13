# Azure Static Web Apps Deployment Guide

This guide will help you deploy your speed test application to Azure Static Web Apps and resolve the GitHub Actions deployment issues.

## Prerequisites

1. **Azure Account**: You need an active Azure subscription
2. **GitHub Repository**: Your code should be in a GitHub repository
3. **Azure Static Web Apps Resource**: Created in Azure portal

## Step 1: Create Azure Static Web Apps Resource

1. Go to the [Azure Portal](https://portal.azure.com)
2. Click "Create a resource"
3. Search for "Static Web Apps"
4. Click "Create"
5. Fill in the basic information:
   - **Subscription**: Your Azure subscription
   - **Resource Group**: Create new or use existing
   - **Name**: `speedtest-app` (or your preferred name)
   - **Region**: Choose the closest region to your users
   - **Hosting Plan**: Free (for testing) or Standard (for production)
6. Click "Review + create" and then "Create"

## Step 2: Configure GitHub Integration

1. In your Azure Static Web Apps resource, go to "Source control"
2. Click "Configure"
3. Choose "GitHub" as the source
4. Authorize Azure to access your GitHub account
5. Select your repository: `amarcoder01/finalsitedeployment1246`
6. Configure the build settings:
   - **Build Preset**: Custom
   - **App location**: `./project`
   - **API location**: `./backend`
   - **Output location**: `dist`
   - **App build command**: `npm ci && npm run build`
   - **API build command**: `npm ci --omit=dev`
7. Click "Review + create" and then "Create"

## Step 3: Fix GitHub Actions Workflow

The main issue you're experiencing is with the Azure Static Web Apps action version. I've fixed this in the workflow files:

### Fixed Issues:

1. **Action Version**: Changed from `Azure/static-web-apps-deploy@v1.0.0` to `Azure/static-web-apps-deploy@v1`
2. **Build Process**: Improved the build configuration to handle your application structure
3. **Dependencies**: Properly configured backend dependencies for Azure

### Available Workflows:

1. **`azure-static-web-apps.yml`**: Full-featured workflow with custom build process
2. **`azure-static-web-apps-simple.yml`**: Simplified workflow using Azure's built-in build

## Step 4: Environment Variables

You'll need to set up these secrets in your GitHub repository:

1. Go to your GitHub repository
2. Click "Settings" → "Secrets and variables" → "Actions"
3. Add the following secrets:
   - `AZURE_STATIC_WEB_APPS_API_TOKEN`: Get this from your Azure Static Web Apps resource
   - `AZURE_STATIC_WEB_APPS_API_TOKEN_ASHY_WAVE_0BF305C00`: Alternative token if needed

### How to Get the API Token:

1. In your Azure Static Web Apps resource, go to "Configuration" → "Management tokens"
2. Click "Generate" to create a new token
3. Copy the token and add it to your GitHub secrets

## Step 5: Deployment Configuration

### Option 1: Use the Fixed Workflow (Recommended)

The main workflow (`azure-static-web-apps.yml`) has been fixed and should work properly. It:

- Uses the correct action version (`@v1`)
- Properly builds the frontend and backend
- Handles dependencies correctly
- Creates the necessary file structure for Azure

### Option 2: Use the Simple Workflow

If you continue to have issues, you can use the simple workflow (`azure-static-web-apps-simple.yml`) which:

- Lets Azure handle the build process
- Requires minimal configuration
- May be more reliable for complex applications

## Step 6: Testing the Deployment

1. Push your changes to the main branch
2. Go to your GitHub repository → "Actions" tab
3. Monitor the workflow execution
4. Check for any errors in the build logs

## Troubleshooting Common Issues

### Issue 1: Action Not Found
```
Error: Unable to resolve action `azure/static-web-apps-deploy@v1.0.0`
```

**Solution**: Use `Azure/static-web-apps-deploy@v1` instead (note the capital 'A' in Azure).

### Issue 2: Build Failures
```
Error: Build failed
```

**Solutions**:
1. Check that all dependencies are properly installed
2. Verify the Node.js version (should be 20.12.0+)
3. Ensure the build commands are correct

### Issue 3: API Not Working
```
Error: API endpoints not found
```

**Solutions**:
1. Verify the `staticwebapp.config.json` file is in the correct location
2. Check that the API location is properly configured
3. Ensure the backend dependencies are included

### Issue 4: Frontend Not Loading
```
Error: Frontend not accessible
```

**Solutions**:
1. Check the `app_location` and `output_location` settings
2. Verify the build output is in the correct directory
3. Ensure the routing configuration is correct

## Configuration Files

### staticwebapp.config.json

This file is crucial for Azure Static Web Apps routing:

```json
{
  "routes": [
    {
      "route": "/api/*",
      "serve": "/api/*",
      "statusCode": 200
    },
    {
      "route": "/*",
      "serve": "/index.html",
      "statusCode": 200
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/images/*.{png,jpg,gif}", "/css/*", "/js/*", "/api/*"]
  },
  "platform": {
    "apiRuntime": "node:20"
  }
}
```

## Monitoring and Debugging

1. **Azure Portal**: Check the "Overview" and "Activity log" in your Static Web Apps resource
2. **GitHub Actions**: Monitor the workflow execution in the Actions tab
3. **Application Logs**: Use Azure Application Insights for detailed logging

## Next Steps

1. Deploy using the fixed workflow
2. Test all functionality (speed test, API endpoints)
3. Configure custom domain if needed
4. Set up monitoring and alerts
5. Optimize performance

## Support

If you continue to experience issues:

1. Check the [Azure Static Web Apps documentation](https://docs.microsoft.com/en-us/azure/static-web-apps/)
2. Review the [GitHub Actions documentation](https://docs.github.com/en/actions)
3. Check the workflow logs for specific error messages
4. Consider using the simple workflow as a fallback

## Alternative Deployment Options

If Azure Static Web Apps continues to cause issues, consider these alternatives:

1. **Render**: Already configured in your repository
2. **Railway**: Also configured and ready to use
3. **Vercel**: Good for React applications
4. **Netlify**: Another popular static hosting option

Each of these has its own advantages and may be easier to configure for your specific use case.
