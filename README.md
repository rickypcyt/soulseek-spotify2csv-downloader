# Spotify → Soulseek

Aplicación web local para convertir una fuente de Spotify en búsquedas de Soulseek, revisar resultados y administrar una biblioteca de audio descargada.

El proyecto está diseñado para ejecutarse en el equipo del usuario. El backend, la interfaz, la base de datos, `slskd` y los archivos descargados permanecen bajo control local.

> La aplicación no está afiliada a Spotify ni a Soulseek. Descarga y conserva únicamente contenido que tengas derecho a utilizar.

## Instalación paso a paso (Windows)

Solo necesitas Windows 10/11 con PowerShell y `winget` (App Installer, incluido en la mayoría de instalaciones de Windows). El script instala automáticamente Python 3.13, Node.js y `slskd` si faltan.

### 1. Abrir una terminal

Pulsa la tecla **Windows**, escribe `PowerShell` y pulsa **Enter**. No hace falta ejecutarla como administrador.

### 2. Elegir dónde instalar

Por ejemplo, en la carpeta Documentos:

```powershell
cd Documents
```

### 3. Descargar el proyecto

Con `git` instalado:

```powershell
git clone https://github.com/rickypcyt/soulseek-spotify2csv-downloader.git
cd soulseek-spotify2csv-downloader
```

Sin `git`, este bloque descarga el ZIP y lo descomprime (todo desde PowerShell):

```powershell
Invoke-WebRequest -Uri "https://github.com/rickypcyt/soulseek-spotify2csv-downloader/archive/refs/heads/main.zip" -OutFile "soulseek.zip"
Expand-Archive soulseek.zip -DestinationPath .
cd soulseek-spotify2csv-downloader-main
```

### 4. Ejecutar el script de inicio

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start.ps1
```

`Set-ExecutionPolicy` solo es necesario en cada terminal nueva para permitir ejecutar el script.

En la primera ejecución, `start.ps1`:

1. Comprueba si existen Python 3.13 y Node.js; si faltan, pregunta si quieres instalarlos automáticamente con `winget`.
2. Instala las dependencias de Python (`config/requirements.txt`) y del frontend (`npm install`).
3. Compila el frontend con `npm run build`.
4. Descarga `slskd` y lo empaqueta junto a la aplicación.
5. Genera el ejecutable `dist\spotify2soulseek.exe` con PyInstaller.
6. Inicia la aplicación.

La primera vez puede tardar varios minutos (descargas y empaquetado). Las siguientes ejecuciones solo recompilan lo que haya cambiado.

### 5. Qué debería pasar

Al terminar, `spotify2soulseek.exe` abre una **consola con los logs** de la aplicación y el navegador se abre automáticamente en:

```text
http://127.0.0.1:5000/
```

**Cerrar la consola detiene el programa.** Cuando se ejecuta como `.exe`, los logs también se guardan en `data/spotify2soulseek.log` junto al ejecutable.

Para volver a abrir la app más tarde puedes:

- Ejecutar `.\start.ps1` otra vez, o
- Hacer doble clic en `dist\spotify2soulseek.exe`.

### 6. Configuración inicial

Crea una aplicación en el [dashboard de Spotify Developer](https://developer.spotify.com/dashboard) y registra esta Redirect URI:

```text
http://127.0.0.1:8080/callback
```

Después, dentro de la aplicación, abre **Settings** y completa:

- Spotify Client ID.
- Spotify Client Secret.
- Redirect URI.
- Usuario de Soulseek.
- Contraseña de Soulseek.
- Carpeta local de descargas.

La URL interna habitual de `slskd` es `http://127.0.0.1:5030`; su API key se genera y administra internamente, no hace falta editar `slskd.yml`.

### Opciones del script

```powershell
.\start.ps1 -Force      # reinstala dependencias y reempaqueta el exe
.\start.ps1 -Yes        # no pregunta antes de instalar con winget
.\start.ps1 -SkipBuild  # salta el build y ejecuta desde fuente (misma db que el exe)
```

Con `-SkipBuild` no se compila el frontend ni se empaqueta: el backend corre directamente con `py -3.13 -m backend.spotify_web` y sirve el último `frontend/dist` disponible. Usa la misma base de datos que el exe (`dist/data`), así que la configuración y la biblioteca se comparten entre ambos modos. Si nunca se ha compilado el frontend, se compila una única vez.

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
- PowerShell.
- `winget` (App Installer) para que `start.ps1` instale automáticamente Python 3.13 y Node.js si faltan; también pueden instalarse manualmente.
- `git` para clonar el repositorio (opcional: se puede descargar como ZIP).
- Cuenta de Spotify Developer si se van a cargar playlists privadas o datos que requieran autorización.
- Cuenta de Soulseek para realizar búsquedas y descargas.

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

La base de datos SQLite y el resto de datos de runtime (config, logs, cachés) se guardan en la carpeta `data/` — en desarrollo bajo la raíz del repo y, cuando corre empaquetada, en `data/` junto al `.exe`:

```text
data/soulseek.db
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

La configuración de pytest y Ruff está en `config/pyproject.toml`. Como ya no está en la raíz, Ruff necesita la ruta explícita:

```powershell
ruff check --config config/pyproject.toml
```

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
config/                     # requirements.txt y pyproject.toml
packaging/soulseek.spec     # Configuración de PyInstaller
data/                       # Datos de runtime (soulseek.db, config, logs)
start.ps1                   # Instalación, build, empaquetado y arranque
```

## Seguridad y responsabilidad

- No publicar la carpeta `data/` (`web_config.json`, `soulseek.db`) ni ningún archivo de secretos.
- No exponer Flask directamente a Internet.
- Utilizar HTTPS, VPN o una red privada si se habilita acceso remoto.
- Mantener la API key de `slskd` protegida.
- Revisar los permisos de las carpetas de descarga.
- Descargar únicamente contenido cuyo uso esté permitido.

## Licencia y atribuciones

Consulta la licencia del repositorio para las condiciones del proyecto:

<https://github.com/rickypcyt/soulseek-spotify2csv-downloader>

La integración con Soulseek se realiza mediante [`slskd`](https://github.com/slskd/slskd), un proyecto independiente.
