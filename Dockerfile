FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css app.js tier-ranking.json /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY vendor /usr/share/nginx/html/vendor

EXPOSE 80
