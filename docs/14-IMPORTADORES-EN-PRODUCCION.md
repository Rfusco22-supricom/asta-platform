# 14 · Pasar los importadores del recomendador a producción

Cómo se llenan en producción las tablas que el kiosco consulta. Issue #56.

Hoy producción tiene **las impresoras que vende Supricom** (120, del catálogo de
Odoo) y **nada más**: ni cartuchos, ni qué cartucho le sirve a qué impresora, ni
qué producto es cada cartucho. Por eso el kiosco contesta «pregunta en el
mostrador» a casi todo.

Esta guía la ejecuta **una persona con acceso a EasyPanel**. Son cuatro
comandos, tres de ellos con simulacro.

> **Las cifras de aquí cuentan con las tres listas del PR que acompaña a este**
> (CF258A, W1500A y el 125 de Canon). Sin ellas el techo baja de 20 a 17 de 20.
>
> **Ensayado el 2026-10-02 de principio a fin**, sobre una base vacía con las
> migraciones aplicadas y el catálogo de impresoras cargado, que es exactamente
> como está producción, y contra el mismo Odoo. Los números de cada paso son los
> que salieron, no estimaciones. Lo único que no se pudo ensayar es el paso 4:
> la tabla que lee **solo existe en producción**.

## Lo que se gana, medido

| | Producción hoy | Después |
|---|---|---|
| Marcas | 5 | **6** |
| Impresoras | 120 | **298** |
| Cartuchos | 0 | **466** |
| Cartucho ↔ impresora | 0 | **256** (163 del fabricante, 93 del nombre) |
| Producto ↔ cartucho | 0 | **1.124** |

Y lo que de verdad decide, el **techo de cobertura del top 20**: si se validara
todo lo que estos importadores proponen, **los 20 más vendidos** quedarían con la
cadena entera. Es el **100 %**, los 989.148 facturados en doce meses.

El ensayo del 2026-10-02 dio primero **17 de 20**: se quedaban fuera el
**CF258A**, el **W1500A** y el **125 de Canon**, que no estaban en las listas de
fabricante y cuyas impresoras no salen del nombre de ningún producto. Se añadieron
esas tres listas, de la web oficial de HP y de Canon, y con ellas el techo pasó a
20 de 20. Por encima del 85 % de #7, la Fase 5 **procede como estaba planeada**.

**El techo no es la cobertura.** Al acabar los cuatro pasos la cobertura real
sigue siendo 0: lo cargado son propuestas. El 85 % es lo que la revisión puede
alcanzar, no lo que alcanza sola.

> **Nada de esto borra nada.** Los cuatro importadores solo crean lo que falta,
> todo entra como **PROPUESTA**, y repetirlos no pisa lo ya revisado: una
> compatibilidad rechazada no vuelve a pendiente y una validada no se toca. Si
> algo sale mal, se para y se mira; no hay que deshacer.

---

## 0. Antes de empezar

### La consola

Todo va en la **consola del servicio `middleware`** (EasyPanel → proyecto `asta`
→ `middleware` → Consola). El prompt es `node@…$`. El directorio ya es
`/app/apps/middleware`, que es donde está `dist/`.

> Si el prompt es `bash-5.1#`, estás en el contenedor de MySQL. No es ese.

### Que el despliegue esté al día

```bash
ls dist/cli/
```

Tienen que aparecer los cuatro: `importar-propuestas.js`,
`importar-listas-fabricante.js`, `importar-impresoras.js` e
`importar-compatibilidades.js`. Si falta alguno, la imagen es anterior a #158:
hay que desplegar `main` otra vez antes de seguir.

### El estado de partida, para poder comparar después

En la consola de **MySQL** (`dashboard` → `database` → Bash,
`mysql -uroot -p"$MYSQL_ROOT_PASSWORD" Asta`):

```sql
SELECT 'marcas' t, COUNT(*) n FROM printer_brands
UNION ALL SELECT 'impresoras', COUNT(*) FROM printer_models
UNION ALL SELECT 'impresoras del catalogo', COUNT(*) FROM printer_models WHERE in_odoo_catalog = 1
UNION ALL SELECT 'cartuchos', COUNT(*) FROM cartridges
UNION ALL SELECT 'cartucho-impresora', COUNT(*) FROM cartridge_printer_models
UNION ALL SELECT 'producto-cartucho', COUNT(*) FROM product_cartridges
UNION ALL SELECT 'tabla de mano', COUNT(*) FROM compatibilidad_productos;
```

Apunta esos números. Al final de la guía se vuelven a mirar.

### Los permisos

Los importadores escriben con `asta_app`, el usuario del middleware, que tiene
permisos **por tabla**. Que el catálogo de impresoras se cargara el 1 de octubre
demuestra que puede escribir en `printer_brands` y `printer_models`; **de las
otras cuatro tablas no hay prueba**. Compruébalo:

```sql
SHOW GRANTS FOR 'asta_app'@'%';
```

Tienen que estar las seis tablas del recomendador, más `SELECT` sobre la tabla de
mano. Si falta alguna, como root:

```sql
GRANT SELECT, INSERT, UPDATE ON Asta.printer_brands           TO 'asta_app'@'%';
GRANT SELECT, INSERT, UPDATE ON Asta.printer_models           TO 'asta_app'@'%';
GRANT SELECT, INSERT, UPDATE ON Asta.printer_model_aliases    TO 'asta_app'@'%';
GRANT SELECT, INSERT, UPDATE ON Asta.cartridges               TO 'asta_app'@'%';
GRANT SELECT, INSERT, UPDATE ON Asta.cartridge_printer_models TO 'asta_app'@'%';
GRANT SELECT, INSERT, UPDATE ON Asta.product_cartridges       TO 'asta_app'@'%';
GRANT SELECT                  ON Asta.compatibilidad_productos TO 'asta_app'@'%';
FLUSH PRIVILEGES;
```

Un permiso que falte se nota enseguida: el importador para con un error de
MySQL. Los tres con simulacro escriben **dentro de una transacción**, así que no
dejan nada a medias; el del paso 1 no, y puede quedarse con parte de los
cartuchos creados. No importa: se vuelve a lanzar y sigue por donde iba, porque
solo crea lo que falta.

---

## 1. Los cartuchos y de qué producto son

```bash
node dist/cli/importar-propuestas.js
```

Lee los consumibles de Odoo y saca de cada nombre **qué cartucho es**: de
«CANON CARTUCHO DE TINTA PG-145 XL» saca `PG-145XL`. Crea los cartuchos que
falten y propone, para cada producto, qué cartucho es o sustituye.

**Este es el único SIN simulacro: escribe directamente**, y tampoco va en una
transacción. Puede repetirse sin problema —solo crea lo que falta—, pero conviene
saber las dos cosas antes de pulsar: si falla a mitad, deja hecho lo que llevaba,
y la forma de arreglarlo es volver a lanzarlo.

Es el primero porque **los otros tres enlazan cartuchos que ya existen**: sin
este, los demás dirán «cartuchos que no existen todavía» y no atarán nada.

Lo que dio en el ensayo:

```
941 productos de CONSUMIBLES (78 sin candidato: captura manual)
marcas creadas:      1
cartuchos creados:   466
propuestas creadas:  1124
```

Los **78 sin candidato** son productos de cuyo nombre no se saca ningún código
de cartucho. No es un fallo: es el tramo que necesita captura manual.

---

## 2. Las impresoras del fabricante, para lo más vendido

```bash
node dist/cli/importar-listas-fabricante.js            # simulacro
node dist/cli/importar-listas-fabricante.js --aplicar
```

Carga las listas de impresoras **copiadas de la web oficial** de HP, Canon y
Epson para los cartuchos del top 20 de ventas (#138). Es la fuente más fiable
que tenemos, y la que cubre justo lo que más factura: `T544`, `667`, `105A`,
`151A`, `954XL`, `PG-145XL`, `CL-146XL`, `T03`, `GI-16`, `GI-190`, `GI-11`.

En el ensayo: **43 listas, 51 cartuchos encontrados, 96 impresoras, 163
compatibilidades**. Las impresoras que ya están en el catálogo se reconocen y no
se duplican, así que ese 85 ya lleva descontadas las repetidas.

Si el simulacro dice «cartuchos que no existen todavía», es que el paso 1 no se
hizo o no encontró ese código. Anótalo, pero no bloquea.

---

## 3. Las impresoras que dice el nombre del producto

```bash
node dist/cli/importar-impresoras.js            # simulacro
node dist/cli/importar-impresoras.js --aplicar
```

Muchos nombres del ERP ya enumeran las impresoras: «ASTA TONER HP CE255A
LaserJet P3010/3015d/3015dn…». Esto las lee y las ata a los cartuchos de ese
mismo producto (#129).

En el ensayo, **después** de los dos pasos anteriores: **82 impresoras nuevas,
93 compatibilidades**, y 31 modelos que ya estaban —del catálogo o del paso 2— y
no se duplicaron. Cinco productos tienen impresoras en el nombre pero ningún
cartucho todavía: son los que el paso 1 dejó sin candidato.

Ojo a una línea del resumen: **«N productos listan varios cartuchos»**. En esos,
el nombre no dice qué impresora va con cuál, así que se propone cada cartucho
con cada impresora y la nota de la fila lo avisa. Son las propuestas que hay que
mirar despacio al revisar.

---

## 4. La tabla escrita a mano

```bash
node dist/cli/importar-compatibilidades.js            # simulacro
node dist/cli/importar-compatibilidades.js --aplicar
```

`compatibilidad_productos` es la tabla que se mantiene desde phpMyAdmin, y
**solo existe en producción**: en desarrollo está vacía, así que este paso no se
ha podido ensayar con datos reales. Por eso, aquí más que en ningún otro: **lee
el simulacro entero antes de aplicar.**

Dos listas del simulacro importan:

- **«Filas de las que no salió ningún modelo»** → el texto de esa fila hay que
  arreglarlo en phpMyAdmin; el importador no adivina.
- **«Códigos sin cartucho previo»** → o es una errata del código, o es un
  cartucho que no vende ningún producto de Odoo.

Y una advertencia que ya está en el código: esa tabla **tiene errores reales**.
La fila del CE278A lista «P560/P566…» por «P1560/P1566…». Entra como PROPUESTA
precisamente por eso; validarlo sin mirar le diría a quien tiene una M130 que le
sirve el CE285A.

---

## 5. Comprobar y seguir

Vuelve a lanzar el SQL del paso 0 y compara. Luego, en el panel:

1. **Compatibilidades**: arriba de la pestaña de productos sale la **cobertura
   del top 20** (#119). Saldrá **baja o cero**, y es lo correcto: lo que acabas
   de cargar son **propuestas**, y la cobertura solo cuenta cadenas validadas.
2. **Revisar, empezando por donde dice esa pantalla**: los productos del top 20,
   que son el 39 % de lo que se factura en consumibles. Cada fila enlaza a la
   pestaña donde se arregla.

Ese es el único paso que no automatiza nadie, y es el que mueve la aguja:
mientras no haya cadenas validadas —impresora → cartucho → producto—, el kiosco
sigue mandando al mostrador.

---

## Lo que esto NO hace

- **No valida nada.** Todo queda pendiente de revisión humana, a propósito (#56):
  un falso positivo le vende al cliente un tóner que no le sirve, en piso de
  venta y delante de él.
- **No toca el catálogo de impresoras** que ya está cargado, ni Odoo, que se lee
  y nunca se escribe.
- **No cubre el ~76 % de consumibles que solo llevan el código del cartucho**
  (`TN-227C`, `W2022A`) y ninguna impresora en el nombre. Para esos hace falta
  más tabla de fabricante, o captura manual.
