# Correos del panel

Los correos de invitación y de reseteo de contraseña los envía **n8n**, en el
flujo «ASTA - Correos del panel» (webhook `asta-correo`). El middleware solo manda
los datos (`plantilla`, `para`, `nombre`, `enlace`, `dias`). Ver
`apps/middleware/src/services/correo.service.ts`.

Aquí se guarda el HTML de cada plantilla, para que el diseño esté versionado y
no viva solo dentro de n8n. Si se cambia en n8n, hay que cambiarlo también aquí.

| Plantilla | Archivo | Variables |
|---|---|---|
| Invitación | `invitacion.html` | `{{nombre}}`, `{{enlace}}`, `{{dias}}`, `{{para}}`, `{{banner}}` |

`{{banner}}` es la imagen de cabecera, publicada por el panel:
`https://asta-panel.larlxe.easypanel.host/correo/banner-invitacion.jpg`
(`apps/web/public/correo/`). Tiene que ser una dirección absoluta y pública: los
programas de correo no ven nada del panel que no lo sea.

El banner se dibuja con el logo blanco (`apps/web/public/asta-logo-blanco.png`) y
el panda de los flyers (`apps/web/public/flyers/panda-saluda.png`), a 1200×440
para que se vea nítido a 600 px de ancho.
