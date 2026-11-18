# Links para compartir: paso a paso

Boom sube tus videos a **tu propia** cuenta de Cloudflare y te da un link del tipo
`https://boom.tu-cuenta.workers.dev/v/AbC123...`. Lo configurás una sola vez (unos 10 minutos) y
después cada video se comparte con un clic.

Todo corre en tu cuenta: el espacio (R2), la página del link (un Worker) y los subtítulos
(Workers AI). Nadie más tiene tus videos ni tu token.

**Cuánto cuesta:** el plan gratis alcanza para la mayoría. Incluye 10 GB guardados (unas 8 horas
de video en calidad máxima a 1080p), reproducciones sin cargo y unas 3 horas de subtítulos por día.
Si te pasás de los 10 GB, Cloudflare cobra unos USD 0,015 por GB por mes.

## Qué necesitás

- Una cuenta de Cloudflare (gratis).
- [Node.js](https://nodejs.org) 20 o más nuevo, para correr los comandos.
- Esta carpeta `cloud` en tu compu. Si instalaste Boom con el instalador, descargá el código desde
  GitHub: botón verde **Code → Download ZIP**, descomprimilo y entrá a la carpeta `cloud`.

## Pasos

### 1. Creá la cuenta y activá R2

1. Creá una cuenta en https://dash.cloudflare.com/sign-up.
2. En el panel de Cloudflare entrá a **R2 Object Storage** y activalo. Pide una tarjeta para
   activarlo, pero no te cobra mientras estés dentro del plan gratis.

### 2. Abrí una terminal en la carpeta `cloud`

- **Windows**: abrí la carpeta `cloud` en el Explorador, escribí `powershell` en la barra de
  dirección y tocá Enter.
- **Mac**: clic derecho sobre la carpeta `cloud` → **Nueva terminal en la carpeta**.
- **Linux**: clic derecho dentro de la carpeta → **Abrir en una terminal**.

### 3. Corré estos comandos, de a uno

Instala las herramientas de Cloudflare:

```bash
npm install
```

Abre el navegador para que entres a tu cuenta y le des permiso:

```bash
npx wrangler login
```

Crea el espacio donde se guardan los videos:

```bash
npx wrangler r2 bucket create boom-videos
```

Guarda tu **token secreto**:

```bash
npx wrangler secret put TOKEN
```

Cuando pregunte el valor, escribí una contraseña larga inventada por vos (por ejemplo, cuatro
palabras al azar con números). Ese es tu token: **quien lo tenga puede subir y borrar videos**, así
que guardalo bien y no lo compartas. Si te pregunta si querés crear el Worker, decí que sí.

Publica tu Boom en la nube:

```bash
npx wrangler deploy
```

Al terminar muestra una dirección como `https://boom.tu-cuenta.workers.dev`. Esa es la
**dirección de tu Boom en la nube**.

> Si es la primera vez que usás Workers, Cloudflare puede pedirte que elijas un subdominio
> (el `tu-cuenta` de la dirección). Elegí uno y volvé a correr `npx wrangler deploy`.

### 4. Conectá Boom

En Boom, pestaña **Compartir**: pegá la dirección y tu token, tocá **Guardar** y después
**Probar conexión**. Si dice *Conexión correcta*, listo: **Copiar link** en cualquier video lo sube
y te deja el link en el portapapeles.

## Subtítulos

Vienen activados y no hace falta configurar nada más: usan Workers AI (Whisper) de tu misma cuenta.
En Boom, pestaña **Compartir**, podés apagarlos o elegir el idioma. Para un video que ya tenía
link, usá **Agregar subtítulos** en *Mis videos*.

Quien mira el link los prende o apaga con el botón **Subtítulos** (o la tecla `C`).

## Usar tu propio dominio (opcional)

Si tu dominio ya está en Cloudflare, podés tener links como `https://videos.tuempresa.com/v/...`:

1. En el panel de Cloudflare: **Workers & Pages → boom → Settings → Domains & Routes → Add →
   Custom domain**.
2. Escribí el subdominio (por ejemplo `videos.tuempresa.com`) y confirmá. Cloudflare crea el
   certificado solo; puede tardar unos minutos.
3. En Boom, pestaña **Compartir**, cambiá la dirección por `https://videos.tuempresa.com` y tocá
   **Guardar**.

Los videos que ya compartiste siguen andando con la dirección vieja.

## Qué ve la otra persona

Una página con el video, velocidades de 0.5× a 2×, subtítulos, botón de descarga y atajos de
teclado. No necesita cuenta ni instalar nada. Los links no aparecen en buscadores, pero
**cualquiera que tenga el link puede ver el video**.

## Actualizar

Cuando salga una versión nueva de Boom con cambios en la página del link, descargá el código nuevo
y corré otra vez, dentro de `cloud`:

```bash
npx wrangler deploy
```

Tus videos y tu token no se tocan.

## Borrar

Al borrar un video desde Boom te ofrece borrar también el link. Para vaciar todo, borrá el bucket
`boom-videos` desde el panel de Cloudflare.

## Para desarrolladores

Probar el Worker en tu compu, sin subir nada a internet (salvo los subtítulos, que siempre corren
en Cloudflare):

```bash
cp .dev.vars.example .dev.vars
```

```bash
npx wrangler dev --port 8787
```

En Boom usá `http://127.0.0.1:8787` como dirección y `token-de-prueba-local` como token. Los videos
quedan en `cloud/.wrangler`.

La página del link está en `page.js` (el logo va embebido en `assets.js`) y la API en `worker.js`.
