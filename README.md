# Spotify → Soulseek

Aplicación local para convertir playlists de Spotify en búsquedas de Soulseek y descargar las canciones que elijas.

La aplicación se ejecuta completamente en tu equipo:

- Spotify se usa para leer playlists y obtener sus canciones.
- `slskd` busca y descarga archivos desde Soulseek.
- Flask proporciona la API local.
- React proporciona la interfaz web.
- Las descargas permanecen en tu ordenador.

> Estado actual: aplicación local para Windows con configuración preparada para usar `keyring` en Windows, macOS y Linux. El proveedor Soulseek utilizado es `slskd`.

## Índice

- [Qué puedes hacer](#qué-puedes-hacer)
- [Requisitos](#requisitos)
- [Instalación y primer arranque](#instalación-y-primer-arranque)
- [Configuración desde la interfaz](#configuración-desde-la-interfaz)
- [Autenticación de Spotify](#autenticación-de-spotify)
- [Uso diario](#uso-diario)
- [Páginas de la aplicación](#páginas-de-la-aplicación)
- [Biblioteca y previews](#biblioteca-y-previews)
- [Persistencia](#persistencia)
- [Puertos utilizados](#puertos-utilizados)
- [Solución de problemas](#solución-de-problemas)
- [Desarrollo y verificaciones](#desarrollo-y-verificaciones)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Seguridad y privacidad](#seguridad-y-privacidad)
- [FAQ](#faq)

## Qué puedes hacer

- Cargar playlists, álbumes, artistas o canciones de Spotify.
- Seleccionar una playlist del usuario autenticado desde la interfaz.
- Buscar varias canciones en Soulseek de forma controlada.
- Revisar resultados por nombre, formato, tamaño, bitrate y velocidad.
- Escuchar previews de hasta 30 segundos.
- Descargar un resultado individual o varias pistas seleccionadas.
- Elegir el criterio de recomendación: calidad, velocidad, duración o balance.
- Elegir un formato preferido: cualquier formato, FLAC, MP3, OGG o M4A.
- Ver siempre primero el resultado recomendado según las preferencias elegidas.
- Guardar las descargas en una carpeta con el nombre de la playlist.
- Ver y reproducir la Biblioteca local.
- Mover previews temporales a la Biblioteca local.
- Descargar o borrar archivos de la Biblioteca y de `temp`.
- Consultar logs, transferencias y estado de los servicios.
- Mantener resultados de búsqueda, preferencias y canciones descargadas entre sesiones.

## Requisitos

Necesitas:

- Windows 10 u 11 para el flujo actual de instalación automática.
- PowerShell 5 o superior.
- Python 3.13.
- Node.js LTS con npm.
- Una cuenta de Spotify Developer para obtener Client ID y Client Secret.
- Una cuenta de Soulseek.

La aplicación escucha localmente y no requiere publicar puertos en Internet.

## Instalación y primer arranque

Abre PowerShell en la raíz del proyecto:

```powershell
cd C:\coding\soulseek
```

Ejecuta únicamente:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\run.ps1
```

`run.ps1` comprueba automáticamente si faltan:

- Dependencias de Python.
- Dependencias del frontend.
- `frontend/node_modules`.
- `slskd.exe`.
- La configuración local de `slskd`.

Si falta algo, ejecuta `setup.ps1` automáticamente. El setup instala las dependencias, descarga la versión fijada de `slskd` y prepara su ruta local. En arranques posteriores no reinstala todo si la instalación ya está lista.

Para una reinstalación forzada:

```powershell
.\setup.ps1 -Force
```

La interfaz principal queda disponible en:

```text
http://127.0.0.1:5000/
```

Para detenerla, vuelve a la terminal y pulsa `Ctrl+C`.

## Configuración desde la interfaz

La configuración se realiza desde la página **Settings**. No es necesario editar `.env`, `.env.local`, `web_config.json` ni `slskd.yml` manualmente.

### Spotify

En Settings completa:

- Spotify Client ID.
- Spotify Client Secret.
- Redirect URI, que debe ser:

```text
http://127.0.0.1:8080/callback
```

### Soulseek

Completa:

- Usuario de Soulseek.
- Contraseña de Soulseek.
- Ruta de `slskd.exe`, si el setup no la detectó automáticamente.
- Carpeta de descargas.

La URL de `slskd` es local y predeterminada:

```text
http://127.0.0.1:5030
```

Por eso no es necesario configurarla manualmente para el uso normal.

### API key de slskd

La aplicación genera automáticamente una API key segura cuando inicia `slskd` por primera vez y la guarda en el almacén seguro mediante `keyring`. La clave se pasa internamente al proceso de `slskd`.

No es necesario copiarla manualmente desde `slskd.yml`. El panel Settings solo muestra si está configurada.

## Autenticación de Spotify

En Settings aparece un card de Spotify con el estado:

- No configurado.
- No conectado.
- Autorizando.
- Conectado.
- Error.

Después de guardar Client ID y Client Secret, pulsa **conectar Spotify**. Se abrirá el navegador para autorizar la aplicación y Spotify volverá a:

```text
http://127.0.0.1:8080/callback
```

Para obtener las credenciales, consulta la guía oficial:

[Spotify Web API - Creating an app](https://developer.spotify.com/documentation/web-api/concepts/apps)

Pasos:

1. Inicia sesión en Spotify Developer.
2. Crea una aplicación.
3. Copia el Client ID.
4. Copia el Client Secret desde Settings de la aplicación.
5. Añade la Redirect URI anterior.
6. Guarda las credenciales en el panel Settings.
7. Pulsa **conectar Spotify**.

El token no se expone en la interfaz ni se guarda en archivos JSON.

## Uso diario

1. Ejecuta:

   ```powershell
   .\run.ps1
   ```

2. Abre:

   ```text
   http://127.0.0.1:5000/
   ```

3. En **Settings**, configura Spotify y Soulseek si es la primera vez.
4. En **Principal**, pega una URL de Spotify o pulsa **cargar mis playlists**.
5. Selecciona una playlist del selector si quieres cargarla desde tu cuenta.
6. Pulsa **Cargar playlist**.
7. Edita el nombre de la carpeta de salida si lo deseas.
8. Espera a que aparezcan las pistas y los resultados de Soulseek.
9. Escucha una preview o descarga un resultado.
10. Para descargar varias pistas, selecciónalas y pulsa **descargar seleccionadas**.

### Búsquedas múltiples

Las búsquedas automáticas se procesan en grupos de cuatro para no saturar `slskd`.

El backend también aplica estas protecciones:

- Máximo de 200 caracteres por query.
- Máximo de 50 búsquedas activas.
- Limpieza automática de búsquedas abandonadas después de 120 segundos.
- Validación de los identificadores de búsqueda.
- El frontend deja de consultar búsquedas terminadas.

## Páginas de la aplicación

La interfaz usa páginas con rutas propias:

```text
/          → Principal
/settings  → Settings
/logs      → Logs
/library   → Biblioteca y previews
```

Las rutas funcionan con el historial del navegador, por lo que puedes usar atrás, adelante y refrescar una sección concreta.

### Principal

Contiene la carga de playlists, las preferencias, las búsquedas, los resultados y las descargas.

### Settings

Contiene la configuración local, el card de autenticación Spotify y la guía para obtener credenciales.

### Logs

Muestra los logs del backend y las transferencias activas de `slskd`. El panel ocupa toda la altura disponible y tiene scroll interno.

### Biblioteca y previews

Muestra la Biblioteca local y los previews temporales en dos columnas en escritorio. En móvil se apilan verticalmente.

Ambas listas tienen paginación y muestran hasta 12 archivos por página.

## Biblioteca y previews

Las previews se descargan primero en:

```text
Soulseek Downloads/temp
```

Desde el card de cada preview puedes:

- Reproducirlo.
- Descargarlo a la Biblioteca.
- Borrarlo.

El botón **descargar** de un preview mueve el archivo a la carpeta de salida de la playlist:

```text
Soulseek Downloads/temp/cancion.flac
        ↓
Soulseek Downloads/Nombre de playlist/cancion.flac
```

La Biblioteca local muestra:

- Jerarquía de carpetas.
- Cards compactos por canción.
- Tipo de archivo.
- Duración.
- Tamaño.
- Reproductor personalizado.
- Borrado de archivos.

Las carpetas `temp` y `.incomplete` no aparecen dentro de la Biblioteca local.

### Canciones ya descargadas

La aplicación identifica canciones descargadas usando:

1. El ID de Spotify guardado en `web_library_index.json`.
2. El nombre de la pista comparado con los archivos existentes como compatibilidad para descargas antiguas.

Si una canción ya está en la Biblioteca, aparece atenuada con el mensaje:

```text
Already downloaded this song
```

La marca depende de la Biblioteca local, no de la cuenta de Soulseek.

## Persistencia

### Configuración

La configuración normal se guarda en:

```text
web_config.json
```

Los secretos se guardan con `keyring` en el almacén nativo del sistema:

```text
Windows → Credential Manager
macOS   → Keychain
Linux   → Secret Service / KWallet
```

### Resultados de búsqueda

Los resultados se guardan en la caché local del navegador por playlist y canción.

- Duran hasta 7 días.
- Se identifican por URL de playlist e ID de Spotify.
- Se guardan hasta 100 resultados por canción.
- Al refrescar no es necesario repetir todas las búsquedas.
- Pulsar **buscar** manualmente actualiza una pista concreta.

### Preferencias

Persisten las preferencias de:

- Calidad.
- Velocidad.
- Duración.
- Balance.
- Formato preferido.

El recomendado siempre aparece primero según esas preferencias y el segundo resultado es la siguiente mejor opción.

### Biblioteca

El índice de canciones descargadas se guarda localmente en:

```text
web_library_index.json
```

## Puertos utilizados

La aplicación principal funciona en:

```text
http://127.0.0.1:5000/
```

`slskd` funciona como servicio interno en:

```text
http://127.0.0.1:5030
```

El usuario normalmente solo debe abrir el puerto `5000`. El puerto `5030` lo utiliza el backend para comunicarse con `slskd`.

El callback local de Spotify utiliza:

```text
http://127.0.0.1:8080/callback
```

## Solución de problemas

### `run.ps1` termina con error o la página muestra archivos antiguos

Puede haber una instancia anterior ocupando el puerto `5000`. Detén la terminal anterior con `Ctrl+C` y vuelve a ejecutar:

```powershell
.\run.ps1
```

Si hace falta localizar el proceso:

```powershell
Get-NetTCPConnection -LocalPort 5000 -State Listen | Select-Object OwningProcess
```

### La API de Spotify responde 404 o 405

Reinicia completamente el backend. Las nuevas rutas de autenticación solo están disponibles después de cargar la versión actual de Flask.

### `429` al buscar en Soulseek

Significa que hay demasiadas búsquedas activas. El backend limpia automáticamente las búsquedas abandonadas después de 120 segundos. Si acaba de ocurrir tras una versión anterior, reinicia:

```powershell
Ctrl+C
.\run.ps1
```

### `spotify/auth/status` responde 404

Normalmente significa que hay un backend antiguo ejecutándose en el puerto `5000`. Detén la instancia anterior y vuelve a arrancar con `run.ps1`.

### `spotify_to_csv.py` no se encuentra

El archivo correcto está en:

```text
backend/spotify_to_csv.py
```

La aplicación resuelve automáticamente esa ruta y usa el mismo intérprete de Python que ejecuta el backend.

### `slskd` aparece como pendiente

Comprueba:

1. Que `slskd.exe` exista en la ruta configurada.
2. Que `slskd` pueda iniciarse.
3. Que el usuario y contraseña de Soulseek estén guardados desde Settings.
4. Que el puerto `5030` no esté ocupado por otra instancia.
5. Que el backend se haya reiniciado después de cambiar la configuración.

### `http://127.0.0.1:5030` no muestra una página

Es normal. `slskd` se ejecuta en modo API/headless. La interfaz que debes abrir es:

```text
http://127.0.0.1:5000/
```

### Spotify vuelve a pedir autorización

Comprueba el Redirect URI:

```text
http://127.0.0.1:8080/callback
```

Si Spotify informa de autorización correcta, puedes cerrar manualmente la pestaña si el navegador no la cierra automáticamente.

### Una preview sigue en `temp`

Una preview se mantiene en `temp` hasta que pulses **descargar** o **guardar en biblioteca**. Al moverla correctamente desaparecerá de Previews y aparecerá en la Biblioteca local.

## Desarrollo y verificaciones

Para desarrollo con recarga automática:

```powershell
.\scripts\dev.ps1
```

La interfaz de desarrollo normalmente está disponible en:

```text
http://127.0.0.1:5173
```

Para verificar el proyecto:

```powershell
cd frontend
npm run lint
npm run build
cd ..

py -3.13 -m pytest -q
py -3.13 -m ruff check backend tests
python -m compileall backend
```

Para validar PowerShell:

```powershell
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\run.ps1), [ref]$tokens, [ref]$errors) | Out-Null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\setup.ps1), [ref]$tokens, [ref]$errors) | Out-Null
$errors
```

## Estructura del proyecto

```text
soulseek/
├── backend/
│   ├── __init__.py
│   ├── spotify_web.py       # Aplicación Flask y API
│   ├── backend_config.py    # Rutas y ajustes del backend
│   ├── local_config.py      # JSON público y keyring
│   ├── spotify_service.py   # Ejecución del conversor
│   └── spotify_to_csv.py    # Conversión de enlaces de Spotify
├── frontend/
│   ├── src/
│   │   ├── api/             # Cliente HTTP
│   │   ├── components/      # Settings y componentes visuales
│   │   ├── utils/            # Ranking de resultados
│   │   ├── App.jsx           # Interfaz y páginas locales
│   │   └── index.css         # Estilos globales
│   ├── public/
│   ├── package.json
│   └── vite.config.js
├── scripts/
│   └── dev.ps1
├── tests/
├── run.ps1
├── setup.ps1
├── requirements.txt
├── pyproject.toml
└── README.md
```

Archivos locales o generados que no deben subirse al repositorio:

- `web_config.json`.
- `web_library_index.json`.
- `web_logs.json`.
- `.env`, `.env.local` y `.env.*` heredados.
- `vendor/`.
- `.setup-cache/`.
- `frontend/node_modules/`.
- `frontend/dist/`.
- Archivos CSV y temporales.

## Seguridad y privacidad

- La aplicación escucha únicamente en `127.0.0.1`.
- Los secretos se guardan en el almacén seguro del sistema mediante `keyring`.
- Los secretos no se guardan en `localStorage` ni en JSON.
- La interfaz nunca vuelve a mostrar Client Secrets, contraseñas o API keys.
- La configuración se introduce desde la interfaz.
- `run.ps1` ya no carga archivos `.env`.
- No compartas `web_config.json`, `web_library_index.json`, tokens, API keys ni contraseñas.
- No publiques los enlaces de callback de Spotify.
- No expongas `slskd` a Internet sin una arquitectura de seguridad adicional.

## FAQ

### ¿Tengo que iniciar `slskd` manualmente?

No. Si `slskd.exe` está configurado, el backend intenta iniciarlo automáticamente. La API key también se genera y configura automáticamente cuando falta.

### ¿Cuál es la URL que debo abrir?

Abre:

```text
http://127.0.0.1:5000/
```

El puerto `5030` es interno para `slskd`.

### ¿Puedo seleccionar una playlist desde Spotify?

Sí. Después de autenticar Spotify desde Settings, pulsa **cargar mis playlists** en Principal, selecciona una playlist y luego pulsa **Cargar playlist**.

### ¿Por qué una canción aparece como descargada?

La aplicación la encontró en la Biblioteca local mediante su ID de Spotify o mediante una coincidencia compatible por nombre de archivo.

### ¿Puedo borrar una preview?

Sí. Desde Biblioteca y previews puedes reproducirla, moverla a la Biblioteca, descargarla o borrarla.

### ¿Puedo borrar el historial sin borrar archivos?

Sí. El historial de playlists solo elimina enlaces guardados en el navegador. No borra descargas ni previews.

### ¿Dónde veo los detalles de un error?

La pestaña **Logs** muestra las operaciones del backend y los estados de las transferencias. No compartas logs que puedan contener información sensible.
