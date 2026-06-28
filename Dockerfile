# Stage 1: Build API dependencies
FROM node:alpine AS api-builder
WORKDIR /app
COPY api/package.json api/server.js ./
RUN npm install --omit=dev

# Stage 2: Final image with nginx + API
FROM nginx:alpine

# Install Node.js for running the API
RUN apk add --no-cache nodejs npm

# Copy frontend files
COPY nginx.conf /etc/nginx/conf.d/default.conf
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
