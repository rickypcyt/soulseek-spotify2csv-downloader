# Spotify → Soulseek

Aplicación local para cargar una playlist de Spotify, buscar sus canciones en Soulseek y descargar los resultados seleccionados.

La aplicación funciona como una web local: se abre en el navegador, pero todo se ejecuta en tu PC. No necesitas publicar ningún puerto ni subir tus archivos a Internet.

> Estado actual: aplicación local para Windows. El proveedor recomendado es `slskd`.

## Qué hace

1. Recibe un enlace de Spotify.
2. Carga las pistas de la playlist, álbum, artista o canción.
3. Genera búsquedas para Soulseek.
4. Muestra resultados y datos como formato, tamaño, bitrate y velocidad.
5. Permite escuchar previews de 30 segundos.
6. Permite seleccionar y descargar canciones.
7. Permite elegir automáticamente resultados por calidad, velocidad, duración o formato.
8. Guarda la configuración localmente para no tener que introducirla en cada uso.

## Requisitos

Instala estas herramientas antes de comenzar:

- Windows 10/11.
- PowerShell 5 o superior.
- Python 3.13.
- Node.js LTS con npm.
- `ffmpeg` disponible en el `PATH` si quieres generar previews.
- `slskd.exe` si usarás `slskd` como proveedor Soulseek.
- Una cuenta de Spotify Developer para obtener Client ID y Client Secret.

## Instalación inicial

Abre PowerShell en la carpeta del proyecto:

```powershell
cd C:\coding\soulseek
```

La forma recomendada es ejecutar el setup una sola vez:

```powershell
.\setup.ps1
```

El setup instala las dependencias del proyecto, descarga una versión fijada de `slskd` desde su release oficial y configura automáticamente el proveedor.

Si PowerShell bloquea la ejecución de scripts, puedes ejecutar:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
```

Para forzar una reinstalación de las herramientas:

```powershell
.\setup.ps1 -Force
```

El setup guarda las herramientas dentro de `vendor/`, una carpeta local excluida de Git. No sube los binarios al repositorio.

## Primer arranque

Ejecuta:

```powershell
.\run.ps1
```

El script construirá el frontend y arrancará el backend local. No cierres esa ventana mientras uses la aplicación.

Abre en el navegador:

```text
http://127.0.0.1:5000
```

Para detener la aplicación, vuelve a PowerShell y pulsa `Ctrl+C`.

> Si PowerShell muestra `Exit code: 1` después de pulsar `Ctrl+C`, normalmente significa que el servidor fue interrumpido manualmente. No es necesariamente un error.

## Configuración desde la interfaz

En la página, abre el panel **configuración local**.

### Spotify

Completa:

- **Spotify Client ID**.
- **Spotify Client Secret**.

Estos datos se obtienen creando una aplicación en el [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

El redirect URI configurado para esta aplicación es:

```text
http://127.0.0.1:8080/callback
```

### Soulseek

Selecciona el proveedor:

```text
slskd
```

Después completa:

- **URL de slskd**. Normalmente:

  ```text
  http://127.0.0.1:5030
  ```

- **Token de slskd**, si tu instancia lo requiere.
- **Ruta de slskd.exe**, por ejemplo:

  ```text
  C:\ruta\a\slskd.exe
  ```

- Usuario y contraseña de Soulseek si el proveedor local los necesita.
- Carpeta de descargas.

Pulsa **guardar configuración**. El backend intentará iniciar el proveedor seleccionado.

### Seguridad de las credenciales

- Los secretos no se guardan en `localStorage` del navegador.
- Las credenciales se guardan usando el almacén seguro de Windows mediante `keyring`.
- La interfaz solo muestra indicadores como `guardado`; nunca vuelve a mostrar el secreto.
- Los tokens y contraseñas no deben aparecer en los logs.
- La aplicación escucha localmente en `127.0.0.1`.

## Uso normal

1. Ejecuta `.\run.ps1` desde la carpeta del proyecto.
2. Abre `http://127.0.0.1:5000`.
3. Si es el primer uso, configura Spotify y slskd.
4. Pega un enlace de Spotify.
5. Pulsa **Cargar playlist**.
6. Espera a que aparezcan las búsquedas.
7. Selecciona los resultados que quieras descargar.
8. Pulsa **Descargar** o **descargar seleccionadas**.

## Solución de problemas

### `bun run dev` dice `Script not found "dev"`

El `package.json` del frontend está dentro de `spotify-soulseek-web`. Usa:

```powershell
cd spotify-soulseek-web
npm run dev
```

El modo `dev` solo inicia Vite. Para utilizar la aplicación completa, ejecuta `.\run.ps1` desde la raíz.

### La página no carga

Comprueba que la ventana de PowerShell siga ejecutando Flask y que estás usando:

```text
http://127.0.0.1:5000
```

### Aparece una pantalla vacía o falta el build

Desde la raíz ejecuta:

```powershell
cd spotify-soulseek-web
npm run build
cd ..
.\run.ps1
```

### `slskd` no responde

Comprueba desde la interfaz:

- Que el proveedor seleccionado sea `slskd`.
- Que la ruta de `slskd.exe` sea válida.
- Que la URL coincida con el puerto en el que escucha `slskd`.
- Que el token sea correcto si está habilitado.
- Que no haya otro proceso ocupando el puerto 5030.

### Se solicita Spotify otra vez

El Client Secret del panel no se vuelve a mostrar, por diseño. Si el campo aparece vacío pero muestra `guardado`, la credencial sigue almacenada.

Si Spotify abre de nuevo el flujo de autorización, puede ser necesario completar otra vez la autorización OAuth o revisar que la aplicación de Spotify tenga configurado el redirect URI correcto.

### El puerto está ocupado

Comprueba qué proceso usa el puerto 5000 o 5030. Detén la instancia anterior de la aplicación antes de iniciar otra.

## Desarrollo

Para trabajar sin reconstruir ni reiniciar manualmente el backend después de cada cambio, ejecuta desde la raíz:

```powershell
.\dev.ps1
```

Este comando inicia:

- Flask con recarga automática para cambios Python.
- Vite con HMR para cambios React/CSS.
- El proxy `/api` hacia Flask en `http://127.0.0.1:5000`.

En desarrollo abre:

```text
http://127.0.0.1:5173
```

Los cambios del frontend aparecen automáticamente. Los cambios del backend provocan una recarga automática de Flask. Para detener ambos servicios, pulsa `Ctrl+C` en la ventana de `dev.ps1`.

El comando `.\run.ps1` continúa siendo el modo normal de ejecución, sirviendo el build de producción en `http://127.0.0.1:5000`.

## Verificaciones del proyecto

Frontend:

```powershell
cd spotify-soulseek-web
npm run lint
npm run build
cd ..
```

Python:

```powershell
py -3.13 -m pytest
py -3.13 -m ruff check backend_config.py local_config.py spotify_service.py spotify_to_csv.py spotify_gui.py spotify_web.py tests
py -3.13 -m py_compile backend_config.py local_config.py spotify_service.py spotify_to_csv.py spotify_gui.py spotify_web.py
```

PowerShell:

```powershell
$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\run.ps1), [ref]$tokens, [ref]$errors) | Out-Null
$errors
```

## Estructura principal

```text
.
├── run.ps1                         # Arranque de la aplicación local
├── spotify_web.py                  # Backend Flask y API
├── backend_config.py               # Rutas y configuración del backend
├── local_config.py                 # Configuración y secretos locales
├── spotify_service.py              # Ejecución del conversor de Spotify
├── spotify_to_csv.py               # Conversión Spotify → CSV
├── requirements.txt                # Dependencias Python
├── tests/                          # Tests Python
└── spotify-soulseek-web/
    ├── src/
    │   ├── api/                    # Cliente HTTP del frontend
    │   ├── components/             # Componentes React
    │   └── utils/                  # Utilidades de selección y formato
    └── package.json
```

## Configuración avanzada y migración

`.env.local` se mantiene únicamente como fallback para usuarios que ya tenían el proyecto configurado. Para un uso normal no necesitas crear ni editar ese archivo.

Si usas el fallback, puedes partir de:

```powershell
Copy-Item .env.example .env.local
```

No compartas `.env.local`, Client Secrets, API keys ni tokens. El archivo está excluido por `.gitignore`.
