# Stage 1: Build API dependencies
# Node 22 LTS 
FROM node:22-alpine AS api-builder

# Install build dependencies for native modules (required for better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY api/package.json ./
RUN npm install --omit=dev
COPY api/server.js api/db.js api/auth.js ./
COPY api/migrations ./migrations

# Stage 2: Final image with nginx + API
FROM node:22-alpine

# Install nginx for serving frontend
RUN apk add --no-cache nginx

# Copy frontend files
COPY nginx.conf /etc/nginx/nginx.conf
COPY index.html /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY assets /usr/share/nginx/html/default-assets
COPY vendor /usr/share/nginx/html/vendor

# Copy API from builder stage
COPY --from=api-builder /app /app/api

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
