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

## Lo que todavía no hace

- **Sesión de cliente y cierre a los 4 minutos** (#41). Hoy se consulta como
  visitante: sin precios y sin nada personal en pantalla.
- **Modo sin conexión** (#42). Ahora, sin red, lo dice y no enseña datos viejos.
- **Token de dispositivo** (#40). La tablet usa la API key de la tienda porque
  `kiosk_devices` todavía no dice a qué almacén pertenece cada tablet, y la
  existencia que se publica es la del almacén del cliente del token. Pedido en
  un issue aparte.

## Por qué la tipografía es tan grande

Se usa **de pie y a distancia de brazo**, no en la mano. El cuerpo base son
24 px y los botones miden 72 px de alto: en una pantalla que se toca con prisa,
los objetivos pequeños se fallan. Ver `src/tema.ts`.
