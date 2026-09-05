# Sitio estático servido por nginx. Ideal para EasyPanel (método de build: Dockerfile).
# Enruta el dominio al puerto 80 en la sección Domains/Proxy del servicio.
FROM nginx:alpine

# Copia solo lo necesario del portal
COPY index.html /usr/share/nginx/html/index.html
COPY assets/ /usr/share/nginx/html/assets/

EXPOSE 80
