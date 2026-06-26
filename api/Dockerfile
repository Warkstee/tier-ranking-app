FROM node:alpine

WORKDIR /app

COPY package.json server.js ./

RUN npm install

EXPOSE 3001

CMD ["node", "server.js"]