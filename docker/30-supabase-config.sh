#!/bin/sh
# Genera config.js a partir de las variables de entorno del servicio (EasyPanel).
# nginx ejecuta automáticamente los scripts de /docker-entrypoint.d/ al arrancar.
set -e
envsubst '${SUPABASE_URL} ${SUPABASE_ANON_KEY}' \
  < /usr/share/nginx/html/config.template.js \
  > /usr/share/nginx/html/config.js
echo "[entrypoint] config.js generado (SUPABASE_URL ${SUPABASE_URL:+definida}${SUPABASE_URL:-VACIA})"
