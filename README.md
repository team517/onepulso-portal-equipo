# onepulso · Portal del equipo

Portal interno de empleados de **OnePulso**: inicio de sesión, calendario semanal/mensual del equipo, tareas y clientes. Aplicación de una sola página (HTML/CSS/JS puro), sin dependencias de build.

## Uso

Abre `index.html` en el navegador, o sírvelo con un servidor estático:

```bash
python -m http.server 8123
# luego abre http://localhost:8123/
```

### Acceso de demostración

- **Correo:** `team@onepulso.online`
- **Contraseña:** `onepulso`

Solo se permiten cuentas `@onepulso.online`. El administrador (`team@`) puede crear más usuarios desde **Usuarios**, y esas personas podrán iniciar sesión.

## Despliegue en Railway

El repo incluye un servidor estático sin dependencias (`server.js`) y `package.json`, así que Railway lo despliega sin configuración adicional:

1. Entra en [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. Autoriza el acceso a GitHub y elige **`team517/onepulso-portal-empleados`** (privado).
3. Railway detecta Node y ejecuta `npm start` (`node server.js`), usando el puerto que asigna (`$PORT`).
4. En **Settings → Networking → Generate Domain** para obtener la URL pública en vivo.

En local: `npm start` (puerto 8080) o `python -m http.server 8123`.

## Funciones

- **Login** con roles (admin / miembro). Sin acceso de invitado.
- **Calendario** en vista **Semana** (grande) o **Mes**, navegable, con el día actual resaltado.
- **Tareas** en el calendario: crear en cualquier día, **arrastrar** para cambiar de fecha, **asignar a un empleado** (tag con su nombre).
- **Completar tareas**: se marcan en verde (**Terminado**, no se borran), con **recomendación** del trabajo y **fotos** adjuntas.
- **× (cruceta)** para eliminar tareas.
- Vista **Tareas** por empleado (Pendientes / Terminadas, filtro Mías / Todas).
- **Clientes** con empleado responsable (tag).
- **Usuarios** (solo admin): crear/quitar accesos.

## Diseño

Sistema de marca OnePulso: tipografía **Inter**, morado `#7A5AF8`, texto `#141319`.

## Estado / próximos pasos

⚠️ La autenticación y los datos (usuarios, tareas, clientes, fotos) se guardan en el **navegador** (`localStorage`) — es una demo funcional, **no** seguridad real ni datos compartidos entre dispositivos.

**Siguiente paso:** conectar a **Supabase** (autenticación real, base de datos y almacenamiento de fotos compartidos).
