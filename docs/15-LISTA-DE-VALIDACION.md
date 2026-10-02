# 15 · Lista de validación: del 0 % al 100 % del top 20

Qué validar, en qué orden y contra qué comprobarlo, para que el kiosco empiece a
recomendar. Sale de #56 y se revisa en el panel, en **Compatibilidades**.

Esta lista **se usa después de pasar los importadores** (`14-IMPORTADORES-EN-PRODUCCION.md`).
Está sacada de un ensayo del 2026-10-02 que dejó una base igual que quedará
producción, contra el Odoo de producción: los productos, los cartuchos y las
impresoras son los que te vas a encontrar.

> **Por qué esto no se puede automatizar.** Todo lo que cargan los importadores
> entra como PROPUESTA a propósito: una compatibilidad falsa le vende al cliente
> un tóner que no le sirve, y se lo vende en piso de venta. Lo que hace falta de
> una persona es **mirar la fuente y confirmar**, no investigar: cada fila trae
> de dónde salió.

---

## Cuánto trabajo es, de verdad

| | Decisiones |
|---|---|
| **Lo mínimo para que la cobertura marque 100 %** | **~35**: un cartucho por producto y una impresora por cartucho |
| **Lo que hace que el kiosco sirva en el mostrador** | **188**: 25 producto ↔ cartucho + 163 cartucho ↔ impresora |

La diferencia importa. Con el mínimo, la pantalla de cobertura dice 100 % pero el
cliente que llega con una **DeskJet 2775** no encuentra su tóner, porque solo se
validó una de las 24 impresoras del 667. **La lista completa es la que vende.**

Y 188 no son 188 investigaciones: las 163 filas de la parte 2 se agrupan en **19
cartuchos** y, dentro de cada uno, casi todas comparten **una sola página del
fabricante**. Abres la página, compruebas que la lista coincide, y validas.

---

## Parte 1 · Los 20 productos: qué cartucho es cada uno

En el panel, pestaña **Productos**. Busca por la referencia y valida la fila.

Son **25 filas** y no 20 porque tres productos proponen más de un cartucho: el
ASTA que sustituye a cuatro, y los dos tóners que llevan el código largo y el
comercial a la vez (`W1105A` y `105A` son el mismo cartucho con los dos nombres
que usa HP; igual el `151A` y el `W1510A`).

| # | Ventas 12 m | Producto | Referencia | Cartucho a validar |
|---:|---:|---|---|---|
| 1 | 164.872 | CANON CARTUCHO DE TINTA PG-145 XL -NEGRO | `8274B001AA` | `PG-145XL` |
| 2 | 110.513 | CANON CARTUCHO CL-146 XL COLOR ORIGINAL | `8276B001AA` | `CL-146XL` |
| 3 | 88.163 | ASTA TONER CB435A/CB436A/CE278A/285 | `A-CB435A-CE278A-CE285A` | `CB435A` · `CB436A` · `CE278A` · `CE285A` |
| 4 | 56.076 | HP CARTUCHO 667 BLACK | `3YM79AL` | `667` |
| 5 | 51.809 | EPSON L1110, L3110, L3150, L5190 BLACK | `T544120-AL` | `T544` |
| 6 | 48.017 | HP CARTUCHO 667 COLOR | `3YM78AL` | `667` |
| 7 | 47.717 | HP TONER 105A NEGRO ORIGINAL | `W1105A` | `W1105A` · `105A` |
| 8 | 47.110 | CANON TONER T03 NEGRO | `2725C001AA` | `T03` |
| 9 | 41.469 | EPSON L1110, L3110, L3150, L5190 MAGENTA | `T544320-AL` | `T544` |
| 10 | 41.283 | HP TONER 151A ORIGINAL LASERJET NEGRO | `W1510A` | `151A` · `W1510A` |
| 11 | 40.498 | CANON TINTA GI-16 - BOTELLA - NEGRO | `4408C001AA` | `GI-16` |
| 12 | 37.371 | EPSON L1110, L3110, L3150, L5190 YELLOW | `T544420-AL` | `T544` |
| 13 | 37.077 | EPSON L1110, L3110, L3150, L5190 CYAN | `T544220-AL` | `T544` |
| 14 | 35.054 | HP TONER LASERJET ORIGINAL | `CF258A` | `CF258A` |
| 15 | 26.474 | HP CARTUCHO 954XL BLACK ORIGINAL INK CARTRIDGE | `L0S71AL` | `954XL` |
| 16 | 26.138 | CANON BOTELLA DE TINTA GI-190 - NEGRO | `0667C001AA` | `GI-190` |
| 17 | 24.918 | ASTA TONER HP W1500A | `A-W1500A` | `W1500A` |
| 18 | 22.883 | CANON TONER 125 NEGRO | `3484B001AA` | `125` |
| 19 | 20.933 | HP CARTUCHO 667XL NEGRO | `3YM81AL` | `667XL` |
| 20 | 20.837 | CANON BOTELLA DE TINTA GI-11 - NEGRO | `4525C001AA` | `GI-11` |

**El tóner ASTA de la fila 3 es el caso que hay que mirar despacio**: propone
cuatro cartuchos porque su nombre lista cuatro. Los cuatro son correctos —ese
tóner sustituye a los cuatro—, pero de ellos solo el CE278A y el CE285A tienen
impresoras; el CB435A y el CB436A se quedan sin ninguna y **eso está bien**: el
producto ya queda cubierto por los otros dos. No hay que buscarles nada.

---

## Parte 2 · Los cartuchos: qué impresora usa cada uno

En el panel, pestaña **Impresoras**. Filtra por el código del cartucho.

La columna «qué abrir» es la fuente que quedó guardada en cada fila, y es lo que
hay que comprobar: si dice una URL, ábrela y contrasta la lista; si dice
**parseo**, salió de leer el nombre de un producto de Odoo y **merece más
desconfianza**.

Verás nombres cortos y raros entre los largos: «HP 2874», «HP 107W», «Epson
L5590». No es un error: son impresoras **que vende Supricom**, y ese es el nombre
con el que están dadas de alta en Odoo. El importador las reconoció y no las
duplicó (#173), así que la fila del fabricante se guardó en la que ya existía.

| Cartucho | Filas | Qué abrir para comprobarlo | Impresoras |
|---|---:|---|---|
| **HP 667XL** | 24 | https://www.hp.com/ec-es/products/ink-toner/product-details/24026942 | HP 2875, HP 2874, HP DeskJet 2776, HP DeskJet 2778, HP DeskJet Ink Advantage 1200, HP DeskJet Ink Advantage 2300, HP DeskJet Ink Advantage 2700, HP DeskJet Ink Advantage 2775, HP DeskJet Ink Advantage 2776, HP DeskJet Ink Advantage 2777, HP DeskJet Ink Advantage 2778, HP DeskJet Ink Advantage 2779, HP DeskJet Ink Advantage 2876, HP DeskJet Ink Advantage 2877, HP DeskJet Ink Advantage 2878, HP DeskJet Ink Advantage 2879, HP DeskJet Ink Advantage 4100, HP DeskJet Ink Advantage 4175, HP DeskJet Ink Advantage 4177, HP DeskJet Ink Advantage 4178, HP DeskJet Ink Advantage 6075, HP DeskJet Ink Advantage 6076, HP DeskJet Ink Advantage 6078, HP DeskJet Ink Advantage 6400 |
| **HP 667** | 24 | https://www.hp.com/ec-es/products/ink-toner/product-details/24026936 | HP 2875, HP 2874, HP DeskJet 2776, HP DeskJet 2778, HP DeskJet Ink Advantage 1200, HP DeskJet Ink Advantage 2300, HP DeskJet Ink Advantage 2700, HP DeskJet Ink Advantage 2775, HP DeskJet Ink Advantage 2776, HP DeskJet Ink Advantage 2777, HP DeskJet Ink Advantage 2778, HP DeskJet Ink Advantage 2779, HP DeskJet Ink Advantage 2876, HP DeskJet Ink Advantage 2877, HP DeskJet Ink Advantage 2878, HP DeskJet Ink Advantage 2879, HP DeskJet Ink Advantage 4100, HP DeskJet Ink Advantage 4175, HP DeskJet Ink Advantage 4177, HP DeskJet Ink Advantage 4178, HP DeskJet Ink Advantage 6075, HP DeskJet Ink Advantage 6076, HP DeskJet Ink Advantage 6078, HP DeskJet Ink Advantage 6400 |
| **Epson T544** | 19 | https://epson.com.mx/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T544-AL/i/T544120-AL<br>https://epson.com.co/Para-el-hogar/Tintas/Botellas-de-Tinta-Epson-T544-AL/i/T544120-AL | Epson EcoTank L1250, Epson EcoTank L1350, Epson EcoTank L3250, Epson EcoTank L3350, Epson L5590, Epson EcoTank L3210, Epson EcoTank L1110, Epson EcoTank L1210, Epson EcoTank L3110, Epson EcoTank L3150, Epson EcoTank L3160, Epson EcoTank L3251, Epson EcoTank L3260, Epson EcoTank L3310, Epson EcoTank L3351, Epson EcoTank L3352, Epson EcoTank L5190, Epson EcoTank L5290, Epson EcoTank L3560 |
| **HP W1105A** | 10 | https://www.hp.com/ph-en/products/ink-toner/product-details/25101519 | HP 107W, HP Laser 107, HP Laser 108, HP Laser 135, HP Laser MFP 135a, HP Laser MFP 135ag, HP Laser MFP 135r, HP Laser 136, HP Laser 137, HP Laser 139 |
| **HP 105A** | 10 | https://www.hp.com/ph-en/products/ink-toner/product-details/25101519 | HP 107W, HP Laser 107, HP Laser 108, HP Laser 135, HP Laser MFP 135a, HP Laser MFP 135ag, HP Laser MFP 135r, HP Laser 136, HP Laser 137, HP Laser 139 |
| **Canon GI-190** | 8 | 8 fichas de Canon Latinoamérica, una por impresora | Canon PIXMA G4110, Canon PIXMA G1100, Canon PIXMA G1110, Canon PIXMA G2100, Canon PIXMA G2110, Canon PIXMA G3100, Canon PIXMA G3110, Canon PIXMA G4100 |
| **Canon GI-16** | 8 | 8 fichas de Canon Latinoamérica, una por impresora | Canon MAXIFY GX5010, Canon MAXIFY GX4010, Canon MAXIFY GX7010, Canon MAXIFY GX7110, Canon MAXIFY GX3010, Canon MAXIFY GX5110, Canon MAXIFY GX6010, Canon MAXIFY GX6110 |
| **HP 954XL** | 8 | https://www.hp.com/mx-es/shop/cartucho-de-tinta-hp-954xl-negra-original-l0s71al.html | HP OfficeJet Pro 7740, HP OfficeJet Pro 8210, HP OfficeJet Pro 8216, HP OfficeJet Pro 8218, HP OfficeJet Pro 8710, HP OfficeJet Pro 8720, HP OfficeJet Pro 8730, HP OfficeJet Pro 8740 |
| **HP CF258A** | 7 | https://www.hp.com/us-en/shop/pdp/hp-58a-black-original-laserjet-toner-cartridge | HP LaserJet Pro MFP M428FDW, HP LaserJet Enterprise M406dn, HP LaserJet Enterprise MFP M430f, HP LaserJet Pro M404dn, HP LaserJet Pro M404dw, HP LaserJet Pro M404n, HP LaserJet Pro MFP M428fdn |
| **Canon GI-11** | 6 | 6 fichas de Canon Latinoamérica, una por impresora | Canon G2170, Canon G3170, Canon PIXMA G4170, Canon G3160, Canon PIXMA G1130, Canon PIXMA G2160 |
| **Canon T03** | 6 | 6 fichas de Canon Latinoamérica, una por impresora | Canon imageRUNNER ADVANCE 525i III, Canon imageRUNNER ADVANCE 525iF III, Canon imageRUNNER ADVANCE 615i III, Canon imageRUNNER ADVANCE 615iF III, Canon imageRUNNER ADVANCE 715iFZ III, Canon imageRUNNER ADVANCE 715iZ III |
| **HP 151A** | 6 | https://www.hp.com/emea_africa-en/products/ink-toner/product-details/2100584417 | HP LaserJet Pro 4003, HP LaserJet Pro 4003n, HP LaserJet Pro MFP 4103, HP LaserJet Pro MFP 4103dw, HP LaserJet Pro MFP 4103fdn, HP LaserJet Pro MFP 4103fdw |
| **HP W1510A** | 6 | https://www.hp.com/emea_africa-en/products/ink-toner/product-details/2100584417 | HP LaserJet Pro 4003, HP LaserJet Pro 4003n, HP LaserJet Pro MFP 4103, HP LaserJet Pro MFP 4103dw, HP LaserJet Pro MFP 4103fdn, HP LaserJet Pro MFP 4103fdw |
| **Canon PG-145XL** | 5 | 5 fichas de Canon Latinoamérica, una por impresora | Canon PIXMA iP2810, Canon PIXMA MG2410, Canon PIXMA MG2510, Canon PIXMA MG3010, Canon PIXMA TS3110 |
| **Canon CL-146XL** | 5 | 5 fichas de Canon Latinoamérica, una por impresora | Canon PIXMA iP2810, Canon PIXMA MG2410, Canon PIXMA MG2510, Canon PIXMA MG3010, Canon PIXMA TS3110 |
| **HP W1500A** | 4 | https://www.hp.com/emea_middle_east-en/products/ink-toner/product-details/35832657 | HP LaserJet M111cw, HP LaserJet MFP M141a, HP LaserJet MFP M141ca, HP LaserJet MFP M141cw |
| **Canon 125** | 3 | https://www.usa.canon.com/shop/p/125-black-toner-cartridge | Canon imageCLASS MF3010, Canon LBP6030W, Canon imageCLASS LBP6000 |
| **HP CE278A** | 2 | parseo: product.template #109825: P1566 / P1606 | HP P1566, HP P1606 |
| **HP CE285A** | 2 | parseo: product.template #110576: LASERJET P1102  P1102W | HP LASERJET P1102, HP LASERJET P1102W |

---

## El orden que yo seguiría

1. **Las cuatro primeras filas de la parte 1** (PG-145XL, CL-146XL, el ASTA de
   los cuatro códigos y el 667): son **419.559** de los 989.148, el 42 % del top
   20, y sus cartuchos ya tienen impresoras del fabricante.
2. **Los cuatro Epson del T544** de una vez: son cuatro productos del top 20
   —negro, cian, magenta, amarillo— y **el mismo cartucho**. Validas una vez y
   caen los cuatro.
3. El resto, de arriba abajo.

## Lo que NO hay que validar sin mirar

### La impresora que sigue duplicada

Hasta el **#173** había doce impresoras repetidas con dos nombres, cada una
creada por un importador distinto. Ahora los importadores las reconocen y queda
**una**, y esta no la puede arreglar el código:

| Marca | Una | La otra |
|---|---|---|
| Canon | **IR1643I II** | 1643I II |

Las dos vienen del **catálogo de Odoo**: son dos productos distintos en el ERP
con nombres distintos. Puede que sean la misma máquina mal dada de alta, o dos
configuraciones de verdad —hay también una «IR1643I» y una «IR 1643IF II»—.
Eso se mira en Odoo, no aquí: mientras tanto, **valida la que te diga el
mostrador** y deja la otra en paz.

Y si al revisar ves dos que te parecen la misma impresora, el criterio es el de
siempre: **no valides las dos**, o el cliente verá su modelo repetido y tendrá
que elegir sin saber en qué se diferencian.

### Las filas de parseo

Son tres cartuchos: **T544**, **CE278A** y **CE285A**. Salieron de leer el nombre
de un producto, no de una página del fabricante, así que merecen una mirada más.

Las del T544 ya no son filas aparte: desde el #173, el «L3110» del nombre y el
«EcoTank L3110» del fabricante son la misma impresora, así que la fila del
fabricante es la que queda y trae su URL.

## Cuándo parar

Cuando la pantalla de cobertura marque **100 % del top 20**. A partir de ahí, lo
que queda es cola larga: el resto del catálogo es el 61 % restante de la
facturación repartido en cientos de productos, y ahí el criterio ya no es esta
lista sino lo que pregunten los clientes (la telemetría del recomendador, #43,
dice qué modelos se buscan y no se encuentran).
