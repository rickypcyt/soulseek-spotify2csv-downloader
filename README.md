# Spotify → Soulseek

Aplicación web local para convertir una fuente de Spotify en búsquedas de Soulseek, revisar resultados y administrar una biblioteca de audio descargada.

El proyecto está diseñado para ejecutarse en el equipo del usuario. El backend, la interfaz, la base de datos, `slskd` y los archivos descargados permanecen bajo control local.

> La aplicación no está afiliada a Spotify ni a Soulseek. Descarga y conserva únicamente contenido que tengas derecho a utilizar.

## Por qué existe

El objetivo del proyecto es resolver un flujo concreto:

1. Partir de una playlist, álbum, artista o canción de Spotify.
2. Convertir sus metadatos en consultas de búsqueda.
3. Buscar esas consultas en Soulseek mediante `slskd`.
4. Revisar manualmente los resultados antes de descargar.
5. Guardar, organizar y reproducir los archivos desde una biblioteca local.

La aplicación separa la función de Spotify —metadatos, playlists y portadas opcionales— de la función de Soulseek —búsqueda y transferencia de archivos—. La decisión final de qué archivo descargar queda en manos del usuario.

## Stack técnico

### Backend

- Python 3.13.
- Flask 3: API HTTP local y servidor de archivos estáticos del frontend.
- `requests`: comunicación con la API HTTP de `slskd` y descargas controladas de imágenes.
- Spotipy: acceso a la Web API de Spotify y flujo OAuth.
- `keyring`: almacenamiento de secretos fuera de archivos de texto siempre que el sistema lo permita.
- Mutagen: lectura y escritura de artwork embebido en MP3, FLAC, M4A/MP4 y OGG/Opus.
- SQLite: persistencia local de preferencias, estados, biblioteca, historial y caché.

### Frontend

- React 19.
- Vite 8.
- Tailwind CSS 3.
- `lucide-react`: iconos de la interfaz.
- `react-toastify`: notificaciones de estado.
- Oxlint: validación del código JavaScript/JSX.

### Servicios externos/locales

- Spotify Web API: lectura de metadatos y playlists autorizadas.
- Soulseek: red de búsqueda y transferencia.
- [`slskd`](https://github.com/slskd/slskd): daemon/API local que conecta la aplicación con Soulseek.

## Arquitectura

```text
┌──────────────────────┐
│ Navegador             │
│ React + Vite build    │
└──────────┬───────────┘
           │ HTTP /api/*
           ▼
┌──────────────────────┐
│ Flask                 │
│ backend/app.py        │
│ blueprints + runtime  │
└──────┬───────┬───────┘
       │       │
       │       ├── SQLite / keyring / filesystem
       │       │
       │       └── Spotify Web API
       │
       ▼
┌──────────────────────┐
│ slskd                 │
│ API local :5030       │
└──────────┬───────────┘
           ▼
      Red Soulseek
```

Flask sirve el build de `frontend/dist` y registra los blueprints de la API. El estado compartido de la aplicación se agrupa en `RuntimeState`, que compone el cliente de `slskd`, la configuración local, el servicio de Spotify, el logger y el servicio de biblioteca.

## Requisitos

- Windows 10/11.
- Python 3.13 con el launcher `py` disponible.
- Node.js LTS y `npm`.
- PowerShell.
- Cuenta de Spotify Developer si se van a cargar playlists privadas o datos que requieran autorización.
- Cuenta de Soulseek para realizar búsquedas y descargas.

## Instalación y primer arranque

### 1. Obtener el proyecto

```powershell
git clone https://github.com/rickypcyt/soulseek-spotify2csv-downloader.git
cd soulseek-spotify2csv-downloader
```

También se puede descargar el repositorio como ZIP.

### 2. Configurar Spotify Developer

Crear una aplicación en:

<https://developer.spotify.com/dashboard>

Registrar esta Redirect URI:

```text
http://127.0.0.1:8080/callback
```

Guardar el Client ID y el Client Secret. Se introducen después desde la interfaz; no deben escribirse en el repositorio ni en el README.

### 3. Ejecutar el setup

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
```

`setup.ps1` realiza estas tareas:

- Instala las dependencias Python de `requirements.txt`.
- Instala las dependencias frontend mediante `npm install`.
- Descarga y prepara la versión fijada de `slskd`.
- Crea o actualiza `vendor/` y la configuración local.
- Conserva la configuración existente cuando es posible.

Para reinstalar forzadamente las dependencias y el binario:

```powershell
.\setup.ps1 -Force
```

### 4. Arrancar la aplicación

```powershell
.\run.ps1
```

`run.ps1` comprueba si existen `node_modules`, las dependencias Python y el ejecutable configurado de `slskd`. Si falta algún componente, ejecuta el setup automáticamente. Después:

1. Compila React con `npm run build`.
2. Inicia el backend con `python -m backend.spotify_web`.
3. Inicia `slskd` desde la configuración local.
4. Sirve la aplicación en:

```text
http://127.0.0.1:5000/
```

### 5. Configuración desde Settings

La primera vez, abrir **Settings** y completar:

- Spotify Client ID.
- Spotify Client Secret.
- Redirect URI.
- Usuario de Soulseek.
- Contraseña de Soulseek.
- Ruta de `slskd.exe`, si no fue detectada automáticamente.
- Carpeta local de descargas.

La URL interna habitual de `slskd` es:

```text
http://127.0.0.1:5030
```

La API key de `slskd` se genera y administra internamente. No es necesario editar manualmente `slskd.yml` para el uso normal.

## Workflow técnico

### 1. Carga de fuente

El frontend envía la fuente a:

```http
POST /api/preview
```

El backend distingue entre:

- URL de playlist de Spotify.
- URL de álbum.
- URL de artista.
- URL de canción.
- Texto libre para buscar directamente en Soulseek.

Para Spotify, el backend ejecuta `backend/spotify_to_csv.py` mediante `backend/spotify_service.py`. El resultado se normaliza como una lista de tracks con:

- Nombre.
- Artistas.
- Álbum.
- Duración.
- URL de Spotify.
- Preview de Spotify, si existe.
- Consulta de Soulseek.
- URL de portada, si Spotify la proporciona.

### 2. Creación de búsquedas

Cada búsqueda se crea mediante:

```http
POST /api/search_soulseek
```

El backend genera un identificador, limita la cantidad de búsquedas simultáneas y llama a:

```http
POST http://127.0.0.1:5030/api/v0/searches
```

El frontend consulta periódicamente el estado mediante:

```http
GET /api/search_soulseek/<search_id>
```

Las respuestas se normalizan para mostrar usuarios, archivos, tamaños, bitrate, extensión y velocidad.

La aplicación utiliza `isComplete` y los estados terminales de `slskd` para distinguir una búsqueda activa de una búsqueda finalizada. Cuando termina una búsqueda se muestra un toast.

### 3. Filtros y recomendación

Los resultados pasan por `frontend/src/utils/resultPicker.js`, donde se aplican:

- Eliminación de duplicados.
- Filtros de formato.
- Coincidencia con la consulta.
- Preferencia de calidad.
- Preferencia de velocidad.
- Duración.
- Ranking balanceado.

Los formatos visibles configurables son:

- MP3.
- WAV.
- AIFF.
- FLAC.

Las preferencias se guardan en SQLite y se cargan al iniciar la interfaz.

### 4. Preview

Al seleccionar un resultado, la aplicación llama a:

```http
POST /api/preview_audio
```

El archivo se solicita a `slskd` y se mantiene temporalmente dentro de la carpeta `temp`.

El estado de la transferencia se consulta mediante:

```http
GET /api/preview/status
```

La interfaz distingue entre:

- En cola.
- Conectando.
- Descargando.
- Sin velocidad todavía.
- Usuario offline.
- Error.
- Completado.

Se pueden mantener varios previews activos simultáneamente. Cada preview se identifica por usuario y archivo y tiene su propio polling.

### 5. Guardado en la biblioteca

Al guardar un preview se envía:

```http
POST /api/preview/save
```

El backend mueve el archivo desde `downloads/temp` a la carpeta de playlist seleccionada, registra la descarga y actualiza la biblioteca local.

Antes de moverlo, el frontend libera el elemento `<audio>` para evitar bloqueos de archivos en Windows. El backend también reintenta el movimiento si el sistema tarda en liberar el handle.

### 6. Artwork

La biblioteca prioriza el artwork embebido dentro del archivo Soulseek. El backend utiliza Mutagen para extraerlo y servirlo mediante:

```http
GET /api/library/cover?path=...
```

También existe una acción explícita para descargar una portada externa y embeberla en el archivo compatible:

```http
POST /api/library/cover/embed
```

Los formatos soportados para insertar artwork son MP3, FLAC, M4A/MP4 y OGG/Opus.

## Persistencia local

La base de datos SQLite se encuentra en la raíz del proyecto:

```text
soulseek.db
```

Contiene datos no secretos como:

- Última playlist cargada.
- Historial de URLs.
- Caché de búsquedas.
- Preferencias de ranking y formatos.
- Preferencias de carpetas de salida.
- Estado descargado/ignorado de tracks.
- Índice de biblioteca.
- Registro de descargas.
- Logs locales.

Las credenciales y secretos se manejan mediante la configuración local y `keyring`. No deben incluirse en commits ni compartirse públicamente.

## Puertos y procesos

| Servicio | Dirección | Función |
|---|---|---|
| Flask | `127.0.0.1:5000` | Aplicación web y API local |
| OAuth local de Spotify | `127.0.0.1:8080` | Callback de autorización |
| slskd | `127.0.0.1:5030` | API local del daemon Soulseek |

Por defecto, el servidor Flask escucha únicamente en localhost. Para acceso desde otro dispositivo habría que cambiar deliberadamente el binding, configurar firewall y añadir autenticación/HTTPS.

## Desarrollo

### Frontend en modo desarrollo

Desde `frontend/`:

```powershell
npm install
npm run dev
```

Vite utiliza un proxy para `/api` hacia el backend local en `127.0.0.1:5000`.

### Build de producción local

```powershell
cd frontend
npm run build
```

El build se genera en:

```text
frontend/dist/
```

### Verificaciones

Tests Python:

```powershell
py -3.13 -m pytest
```

Lint frontend:

```powershell
cd frontend
npm run lint
```

Build frontend:

```powershell
npm run build
```

La configuración de pytest y Ruff está en `pyproject.toml`.

## Estructura relevante

```text
backend/
├── app.py                 # Factory Flask y registro de blueprints
├── runtime.py             # Estado compuesto de la aplicación
├── spotify_web.py         # Entry point del servidor
├── spotify_service.py     # Ejecución y lectura del conversor Spotify
├── spotify_to_csv.py      # Obtención y normalización de tracks Spotify
├── slskd_client.py        # API, proceso, búsquedas y transferencias slskd
├── database.py             # Persistencia SQLite
├── local_config.py         # Configuración local y secretos
├── library_service.py      # Índice y artwork de la biblioteca
├── fs_utils.py             # Seguridad de paths y operaciones de archivos
└── routes/                 # Endpoints Flask por dominio

frontend/
├── src/App.jsx             # Composición principal de la aplicación
├── src/components/         # UI
├── src/hooks/              # Estado y polling de dominios
├── src/api/client.js       # Cliente HTTP local
├── src/utils/resultPicker.js # Ranking y filtros de resultados
└── src/utils/storage.js    # Preferencias y caché

tests/                      # Tests Python
setup.ps1                   # Instalación de dependencias y slskd
run.ps1                     # Build y arranque local
soulseek.db                 # Persistencia SQLite local
```

## Seguridad y responsabilidad

- No publicar `web_config.json`, `soulseek.db` ni ningún archivo de secretos.
- No exponer Flask directamente a Internet.
- Utilizar HTTPS, VPN o una red privada si se habilita acceso remoto.
- Mantener la API key de `slskd` protegida.
- Revisar los permisos de las carpetas de descarga.
- Descargar únicamente contenido cuyo uso esté permitido.

## Licencia y atribuciones

Consulta la licencia del repositorio para las condiciones del proyecto:

<https://github.com/rickypcyt/soulseek-spotify2csv-downloader>

La integración con Soulseek se realiza mediante [`slskd`](https://github.com/slskd/slskd), un proyecto independiente.
