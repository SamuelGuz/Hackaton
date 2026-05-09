# Imagen alineada con el pre-pull en .github/workflows/build.yml
FROM nginx:1.25-alpine

COPY public/ /usr/share/nginx/html/

EXPOSE 80
