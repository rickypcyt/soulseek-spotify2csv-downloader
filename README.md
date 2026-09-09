# Spotify → Soulseek

Aplicación local para convertir playlists de Spotify en búsquedas de Soulseek y descargar las canciones que elijas.

La aplicación se ejecuta completamente en tu PC:

- Spotify se usa para leer la playlist.
- `slskd` se usa para buscar y descargar archivos.
- Flask sirve la aplicación local.
- React proporciona la interfaz web.
- Tus credenciales y archivos permanecen en tu equipo.

> Estado actual: aplicación local para Windows. El proveedor Soulseek utilizado es `slskd`.

## Índice

- [Qué puedes hacer](#qué-puedes-hacer)
- [Requisitos](#requisitos)
- [Instalación rápida](#instalación-rápida)
- [Primer arranque](#primer-arranque)
- [Configuración](#configuración)
- [Uso diario](#uso-diario)
- [Dónde se guardan los archivos](#dónde-se-guardan-los-archivos)
- [Estado de la configuración](#estado-de-la-configuración)
- [Historial de playlists](#historial-de-playlists)
- [Solución de problemas](#solución-de-problemas)
- [Desarrollo](#desarrollo)
- [Verificaciones](#verificaciones)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Seguridad y privacidad](#seguridad-y-privacidad)
- [FAQ](#faq)

## Qué puedes hacer

1. Pegar un enlace de Spotify.
2. Cargar una playlist, álbum, artista o canción.
3. Buscar las pistas en Soulseek.
4. Revisar resultados por nombre, formato, tamaño, bitrate y velocidad.
5. Escuchar previews de hasta 30 segundos.
6. Elegir manualmente qué archivos descargar.
7. Marcar automáticamente el resultado **Recomendado** según calidad, velocidad, duración o balance.
8. Descargar varias pistas a la vez.
9. Exportar la playlist como CSV o como lista de búsquedas.
10. Guardar playlists recientes en el navegador para volver a cargarlas rápidamente.
11. Consultar desde la interfaz si Spotify, slskd, el backend y la carpeta de descargas están listos.

## Requisitos

Necesitas:

- Windows 10 u 11.
- PowerShell 5 o superior.
- Python 3.13.
- Node.js LTS con npm.
- Una cuenta de Spotify Developer para obtener un Client ID y un Client Secret.
- Una cuenta de Soulseek para buscar y descargar archivos.

No necesitas publicar puertos en Internet. La aplicación escucha localmente en `127.0.0.1`.

## Instalación rápida

### 1. Abrir PowerShell en el proyecto

```powershell
cd C:\coding\soulseek
```

### 2. Ejecutar el setup

```powershell
.\setup.ps1
```

El setup:

- Comprueba que Python y npm estén instalados.
- Instala las dependencias de Python.
- Instala las dependencias del frontend.
- Descarga la versión fijada de `slskd`.
- Guarda `slskd` dentro de `vendor/` o en la ruta local configurada por el proyecto.
- Prepara la configuración inicial del proveedor.

Si PowerShell bloquea los scripts, permite la ejecución solamente para la ventana actual:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
```

Para forzar la reinstalación de las herramientas:

```powershell
.\setup.ps1 -Force
```

Los binarios descargados, caches y configuraciones locales están excluidos de Git.

## Primer arranque

Desde la raíz del repositorio ejecuta:

```powershell
.\run.ps1
```

El script hace dos cosas:

1. Construye el frontend ubicado en `frontend/`.
2. Inicia el backend Flask como módulo Python.

No cierres esa ventana de PowerShell mientras utilices la aplicación.

Abre esta dirección en el navegador:

```text
http://127.0.0.1:5000
```

Para detener el servidor, vuelve a PowerShell y pulsa `Ctrl+C`.

> Si aparece `Exit code: 1` después de pulsar `Ctrl+C`, normalmente significa que el servidor fue interrumpido manualmente.

## Configuración

En la aplicación abre **Configuración local**. Después de guardar, el panel **Estado de la configuración** te indica qué partes están listas.

### Spotify

Completa:

- **Spotify Client ID**.
- **Spotify Client Secret**.

Puedes obtenerlos creando una aplicación en el [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

Configura este Redirect URI en la aplicación de Spotify:

```text
http://127.0.0.1:8080/callback
```

La primera vez que cargues una playlist privada o que requiera autorización, Spotify abrirá el navegador para pedir permiso.

### Soulseek / slskd

Completa:

- **URL de slskd**:
  ```text
  http://127.0.0.1:5030
  ```
- **API key de slskd**, si está habilitada.
- **Usuario Soulseek**.
- **Contraseña Soulseek**.
- **Ruta de slskd.exe**, por ejemplo:
  ```text
  C:\coding\soulseek\slskd-0.26.0-win-x64\slskd.exe
  ```

La aplicación inicia `slskd` en modo API/headless. Esto significa que `slskd` funciona como servicio interno para la aplicación y no necesariamente muestra una página web si visitas directamente el puerto `5030`.

### Carpeta de descargas

Indica una carpeta donde quieras guardar los archivos finales, por ejemplo:

```text
C:\Users\tu_usuario\Music\Soulseek Downloads
```

Pulsa **guardar configuración** después de completar los campos.

## Estado de la configuración

El panel **Estado de la configuración** comprueba por separado:

- **Backend**: si la aplicación Flask responde.
- **Spotify**: si existen el Client ID y el Client Secret.
- **Soulseek / slskd**: si el proceso responde, la URL funciona y la API key está configurada.
- **Ruta de slskd.exe**: si el archivo existe.
- **Carpeta de descargas**: si la carpeta existe.

Los estados significan:

- **Correcto**: la comprobación pasó.
- **Revisar**: falta algo o el servicio no responde.
- **Pendiente**: todavía no se recibió el diagnóstico inicial.

## Uso diario

1. Ejecuta:
   ```powershell
   .\run.ps1
   ```
2. Abre:
   ```text
   http://127.0.0.1:5000
   ```
3. Revisa el panel **Estado de la configuración**.
4. Pega una URL de Spotify.
5. Pulsa **Cargar playlist**.
6. Espera a que aparezcan las pistas y las búsquedas.
7. Ajusta el criterio de selección si quieres:
   - Mejor calidad.
   - Más rápido.
   - Más largo.
   - Balanceado.
8. Revisa los resultados.
9. Pulsa **Escuchar** para una preview o **Descargar** para guardar un archivo.
10. Para descargar varias pistas, selecciónalas y pulsa **descargar seleccionadas**.

### Resultado recomendado

La etiqueta **Recomendado** identifica el resultado que el algoritmo considera mejor según el criterio elegido. No significa que el archivo ya esté descargado ni inicia una descarga automáticamente.

## Dónde se guardan los archivos

Las previews se descargan primero en una carpeta temporal dentro de la carpeta configurada:

```text
C:\Users\tu_usuario\Music\Soulseek Downloads\temp
```

Una preview permanece temporal porque solo sirve para escuchar una muestra corta.

Un archivo solamente se mueve a la carpeta final cuando pulsas **Descargar** o **descargar seleccionadas**. El flujo es:

```text
temp\archivo.flac
        ↓
Downloads\[playlist]\archivo.flac
```

Después de moverlo, el archivo temporal se elimina. Las previews no se mueven a la carpeta final por sí solas.

## Historial de playlists

Las playlists cargadas correctamente se guardan en el historial local del navegador.

Desde **Historial local de playlists** puedes:

- Ver las playlists recientes.
- Seleccionar una playlist y volver a poner su URL en la barra.
- Cambiar de una playlist a otra sin perder el historial.
- Borrar todo el historial.

El historial:

- Utiliza `localStorage`.
- Es independiente por navegador y perfil de usuario.
- No se envía al backend.
- Conserva hasta 20 enlaces.
- Se mantiene aunque cierres y vuelvas a abrir la aplicación.

## Solución de problemas

### `.\run.ps1` no se reconoce

Asegúrate de estar en la raíz del proyecto:

```powershell
cd C:\coding\soulseek
.\run.ps1
```

El script principal está en la raíz. El único script dentro de `scripts/` es el de desarrollo:

```powershell
.\scripts\dev.ps1
```

### PowerShell bloquea la ejecución

Ejecuta:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\run.ps1
```

### La página no carga

Comprueba que la ventana de PowerShell siga abierta y que el backend indique:

```text
Running on http://127.0.0.1:5000
```

Después abre:

```text
http://127.0.0.1:5000
```

### La aplicación muestra una pantalla vacía o falta el build

Desde la raíz ejecuta:

```powershell
cd frontend
npm run build
cd ..
.\run.ps1
```

### Soulseek / slskd aparece como pendiente

Comprueba en **Configuración local**:

1. Que la URL sea `http://127.0.0.1:5030`.
2. Que la API key sea correcta.
3. Que la ruta de `slskd.exe` exista.
4. Que el usuario y la contraseña de Soulseek estén guardados.
5. Que no haya otro proceso ocupando el puerto 5030.

Después guarda la configuración y reinicia:

```powershell
Ctrl+C
.\run.ps1
```

### `http://127.0.0.1:5030` no muestra una página

Es normal si `slskd` está en modo API/headless. El puerto `5030` es utilizado internamente por el backend. La interfaz que debes abrir es:

```text
http://127.0.0.1:5000
```

### Se solicita Spotify otra vez

El Client Secret no se vuelve a mostrar por seguridad. Si el campo aparece vacío pero indica `guardado`, la credencial sigue almacenada.

Si Spotify vuelve a abrir el flujo de autorización:

- Completa la autorización.
- Verifica el Redirect URI:
  ```text
  http://127.0.0.1:8080/callback
  ```
- Si la pestaña de callback no se cierra automáticamente, ciérrala manualmente después de ver la autenticación exitosa.

### Una descarga sigue en `temp`

Comprueba que la acción utilizada haya sido **Descargar** y no **Escuchar**. Las previews permanecen en `temp` por diseño.

Si una descarga explícita quedó pendiente, reinicia la aplicación:

```powershell
Ctrl+C
.\run.ps1
```

Después vuelve a pulsar **Descargar**.

### El puerto 5000 o 5030 está ocupado

Detén la instancia anterior de la aplicación o identifica el proceso que utiliza el puerto antes de iniciar otra instancia.

## Desarrollo

Para trabajar con recarga automática ejecuta desde la raíz:

```powershell
.\scripts\dev.ps1
```

Este comando inicia:

- Flask con recarga automática para cambios Python.
- Vite con HMR para cambios React y CSS.
- El proxy `/api` hacia Flask.

En desarrollo abre:

```text
http://127.0.0.1:5173
```

Para el uso normal y el build de producción utiliza:

```powershell
.\run.ps1
```

## Verificaciones

### Frontend

```powershell
cd frontend
npm run lint
npm run build
cd ..
```

### Python

```powershell
py -3.13 -m pytest
py -3.13 -m ruff check backend tests
py -3.13 -m py_compile backend/backend_config.py backend/local_config.py backend/spotify_service.py backend/spotify_to_csv.py backend/spotify_web.py
```

### PowerShell

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
│   ├── local_config.py      # Configuración y secretos locales
│   ├── spotify_service.py   # Ejecución de procesos de Spotify
│   └── spotify_to_csv.py    # Conversión de enlaces a CSV
├── frontend/
│   ├── src/
│   │   ├── api/             # Cliente HTTP
│   │   ├── components/       # Componentes React
│   │   ├── utils/            # Utilidades
│   │   ├── App.jsx           # Interfaz principal
│   │   └── index.css         # Estilos globales
│   ├── public/               # Recursos públicos
│   ├── package.json
│   └── vite.config.js
├── scripts/
│   └── dev.ps1               # Arranque de desarrollo
├── tests/                    # Tests Python
├── run.ps1                   # Arranque normal
├── setup.ps1                 # Instalación inicial
├── requirements.txt
├── pyproject.toml
└── README.md
```

Los siguientes elementos son locales o generados y no deben subirse al repositorio:

- `.env.local`.
- `web_config.json`.
- `web_logs.json`.
- `vendor/`.
- `.setup-cache/`.
- `frontend/node_modules/`.
- `frontend/dist/`.
- Archivos CSV y temporales.

## Seguridad y privacidad

- La aplicación escucha únicamente en `127.0.0.1`.
- Los secretos se guardan en el almacén seguro del sistema mediante `keyring` cuando está disponible.
- Los secretos no se guardan en `localStorage`.
- La interfaz muestra `guardado`, pero nunca vuelve a mostrar Client Secrets, contraseñas o API keys.
- No compartas `.env.local`, `web_config.json`, tokens, API keys ni contraseñas.
- No publiques los enlaces de callback de Spotify, porque pueden contener códigos temporales de autorización.
- Revisa las normas de uso de Spotify y Soulseek para el contenido que descargues.

## FAQ

### ¿Tengo que iniciar `slskd` manualmente?

No necesariamente. Si la ruta de `slskd.exe` está configurada, el backend intenta iniciarlo automáticamente. Si el proceso no inicia, revisa el panel de estado y los logs.

### ¿Por qué una preview no aparece en la carpeta final?

Porque una preview es temporal. Solo un archivo solicitado mediante **Descargar** se mueve a la carpeta final.

### ¿El historial funciona para varios usuarios?

El historial pertenece al perfil del navegador que lo creó. Si varias personas utilizan perfiles de navegador diferentes, cada una tendrá su propio historial.

### ¿Puedo borrar el historial sin borrar mis archivos?

Sí. **Borrar historial** solo elimina los enlaces guardados en `localStorage`. No elimina playlists, descargas ni archivos temporales.

### ¿Por qué una playlist nueva reemplaza la anterior?

La interfaz muestra una playlist activa a la vez para mantener el espacio de trabajo ordenado. La playlist anterior sigue disponible desde el historial local.

### ¿Qué hago si una ventana de Spotify no se cierra?

Si muestra que la autenticación fue exitosa, puedes cerrar esa pestaña manualmente. El navegador puede impedir que una página cierre una pestaña que no fue abierta por JavaScript.

### ¿Dónde puedo ver los detalles de un error?

La interfaz muestra los errores principales y el panel de logs registra las operaciones del backend. Nunca compartas logs que puedan contener información sensible.
