# Sitio estático servido por nginx. Ideal para EasyPanel (método de build: Dockerfile).
# Enruta el dominio al puerto 80 en la sección Domains/Proxy del servicio.
FROM nginx:alpine

# Copia el portal
COPY index.html /usr/share/nginx/html/index.html
COPY assets/ /usr/share/nginx/html/assets/

# Supabase: plantilla + valor por defecto. El entrypoint rellena config.js
# con las variables de entorno del servicio (SUPABASE_URL / SUPABASE_ANON_KEY).
COPY config.js /usr/share/nginx/html/config.js
COPY config.template.js /usr/share/nginx/html/config.template.js
COPY docker/30-supabase-config.sh /docker-entrypoint.d/30-supabase-config.sh
RUN chmod +x /docker-entrypoint.d/30-supabase-config.sh

EXPOSE 80
