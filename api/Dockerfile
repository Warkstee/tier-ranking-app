FROM node:alpine

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 3001

CMD ["node", "server.js"]