# Kiosco de Asta (app de tablet)

App Expo / React Native del kiosco de piso de venta. Issue #40.

El cliente escribe su modelo de impresora y ve **qué tóner le sirve y si lo hay
en la tienda**. Tres pantallas: atracción → buscar → resultados.

```bash
pnpm --filter @asta/mobile start     # Expo en modo desarrollo
pnpm --filter @asta/mobile test      # lógica: cliente de la API y temporizador
```

## Preparar una tablet

1. **La API key.** En `app.json`, `extra.apiKey`, la key de la tienda con el
   permiso `RECOMMENDER_READ` **y ninguno más**. Se crea en el panel, en «Mis
   API keys». **No se commitea**: se pone al preparar cada tablet.
2. **La URL.** `extra.apiBase`, el middleware. En el emulador de Android,
   `http://10.0.2.2:3001` es el `localhost` de la máquina anfitriona.
3. **Bloquear la tablet.** La app ya se pone a pantalla completa, bloquea la
   orientación y evita que la pantalla se apague, pero **eso no impide salirse
   de la app**. Para que sea un kiosco de verdad hace falta, además, una de
   estas dos cosas en el Android de la tablet:
   - **Fijar la pantalla** (Ajustes → Seguridad → Fijar apps): gratis, y basta
     para un mostrador atendido.
   - **Modo dispositivo dedicado** (device owner), si se compran tablets para
     esto: impide salir incluso sin nadie delante.

## La sesión (#41)

La tablet es un dispositivo **compartido**: lo que queda en pantalla es del
cliente anterior. Al tocar la pantalla de atracción empieza una sesión que:

- **se cierra sola a los 4 minutos** sin que nadie toque;
- **avisa 30 segundos antes**, con «Sigo aquí», porque cerrarle la sesión a
  alguien que está comparando dos tóners parece una avería;
- se puede cerrar a mano con **«Terminar»**, siempre visible;
- **al cerrarse no queda nada suyo**: las pantallas se desmontan, y con ellas la
  búsqueda, el modelo elegido y los resultados.

Del lado del servidor, `pnpm kiosco:cerrar-sesiones` cierra las filas de
`kiosk_sessions` vencidas que la tablet no pudo cerrar —se apagó, se quedó sin
red—. Va en un cron, como las alertas; está en `docs/05-RUNBOOKS.md`.

Hoy se consulta como **visitante**: sin precios y sin nada personal en pantalla.
La sesión se construye ahora para no tener que añadirla cuando sí los haya (#31).

## Sin conexión (#42)

La tienda se queda sin internet a media mañana y la tablet sigue sirviendo:

- **Se guarda lo que se consulta** —búsquedas y compatibles—, no el catálogo
  entero: cada tienda usa un puñado de modelos y son los que se repiten.
- **Sin red se enseña lo último que se supo, con su fecha** («de hace 6 min») y
  un aviso de que la existencia puede haber cambiado. Caduca a las 12 horas:
  cubre una jornada, y más allá ya no dice nada útil.
- **Un 403 o un 404 NO se tapan con la caché.** Ahí el servidor contestó: tapar
  un 403 escondería que la tablet está mal configurada.
- **El estado de la conexión está siempre visible**, también en la pantalla de
  atracción. Es para el personal: si lleva media mañana sin red, alguien tiene
  que verlo sin ponerse a buscar una impresora.
- **Al volver la red, la pantalla se pone al día sola.** Mientras está caída se
  comprueba cada 15 s con `/health`; con la red buena no se sondea.

## Lo que todavía no hace
- **Token de dispositivo** (#40). La tablet usa la API key de la tienda porque
  `kiosk_devices` todavía no dice a qué almacén pertenece cada tablet, y la
  existencia que se publica es la del almacén del cliente del token. Pedido en
  un issue aparte.

## Por qué la tipografía es tan grande

Se usa **de pie y a distancia de brazo**, no en la mano. El cuerpo base son
24 px y los botones miden 72 px de alto: en una pantalla que se toca con prisa,
los objetivos pequeños se fallan. Ver `src/tema.ts`.
