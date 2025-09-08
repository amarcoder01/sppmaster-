# Multi-stage build for speed test application

# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

# Copy frontend package.json and install dependencies
COPY project/package.json project/package-lock.json* ./
RUN npm ci

# Copy frontend source code and build
COPY project/ ./
# Ensure the build command has all necessary environment variables
ENV NODE_ENV=production
RUN npm run build || (echo "Build failed" && exit 1)

# Stage 2: Build the Node.js backend
FROM node:20-alpine AS backend-build
WORKDIR /app/backend

# Copy backend package.json and install dependencies
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

# Copy backend source code
COPY backend/ ./

# Stage 3: Production image
FROM node:20-alpine
WORKDIR /app

# Copy built backend from backend-build stage
COPY --from=backend-build /app/backend ./backend

# Copy built frontend from frontend-build stage to backend's public directory
COPY --from=frontend-build /app/frontend/dist ./backend/public

# Copy the startup script
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

# Install curl for healthchecks (used by docker-compose)
RUN apk add --no-cache curl

# Expose port for the unified server
EXPOSE 10000

# Start the backend server (which now serves frontend too)
ENTRYPOINT ["/docker-entrypoint.sh"]