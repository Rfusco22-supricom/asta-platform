/**
 * Modo presentación: tapa lo que es de la empresa para enseñar el panel a un
 * cliente con la cuenta del personal (ver `lib/presentacion.ts`).
 *
 * ── Qué tapa ─────────────────────────────────────────────────────────────────
 *
 *   · en cualquier texto: importes («$1.234,56», «$53,1 mil», «−$2,2 M»),
 *     cantidades con su unidad («267 facturas», «4 de 12 clientes», «45,7 %»),
 *     correos, RIF y teléfonos;
 *   · un texto que es solo un número («22», «1.405»), salvo un año o una sola
 *     cifra suelta (el puesto en una lista);
 *   · en las baldosas de resumen (`.stat`), cualquier número de la nota
 *     («497 de 548 ya son pedido»);
 *   · el texto entero de `[data-privado]`, `.cliente-nombre`, `.cliente-contacto`
 *     y de las cifras grandes (`.stat-value` de las baldosas, la del Inicio…);
 *   · las columnas de una tabla cuyo encabezado es «Cliente», «Vendedor»,
 *     «Persona», «Correo»…, y las celdas que son solo un número;
 *   · el `title` que lleve algo de lo anterior, al pasar el ratón por encima.
 *
 * `[data-publico]` lo deja ver: las cuotas del Programa son las mismas para
 * todos y es justo lo que se le explica al cliente.
 *
 * ── Cómo, y por qué así ──────────────────────────────────────────────────────
 *
 * No cambia el texto: lo MARCA con la API de resaltados de CSS y
 * `::highlight(tapado)` lo pinta como una barra (`globals.css`). Si cambiara el
 * texto, React lo encontraría distinto al hidratar y volvería a pintar la
 * página entera, con un destello de las cifras de verdad.
 *
 * Va en el <head> y vigila el documento desde antes de que llegue el <body>.
 * Los avisos de cambios se atienden antes de pintar, así que cada trozo nuevo
 * —también lo que llega después por streaming o al navegar— sale ya tapado.
 *
 * Es para la pantalla, no un permiso: el dato sigue en la página.
 */
(function (global) {
  // Un importe, una cantidad con su unidad, un correo, un RIF o un teléfono de Venezuela.
  var SUELTOS =
    /[−-]?\$\s?\d[\d.,]*(?:\s?(?:mil|M)(?![\p{L}]))?|(?<![\p{L}\d.,])(?:\d[\d.,]*\s(?:de|\/)\s)?\d[\d.,]*\s?(?:%|u\.|(?:unidad|factura|cliente|compra|producto|referencia|pedido|cotizaci[oó]n|sugerencia|token|distint[oa])(?:es|s)?(?![\p{L}]))|[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+|\b[VEJPGC]-?\d{6,9}(?:-?\d)?\b|(?<=\bRIF\b[\s·:]*)\d[\d-]{4,}|(?:\+58[\s-]?|\b0)(?:2\d\d|4(?:12|14|16|22|24|26))[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/gu;
  var COLUMNAS = /^(clientes?|vendedor(es)?|cartera|cartera de|persona|usuario|usuario de odoo|correo|email|rif|tel[eé]fono|contacto|tienda)$/i;
  var NUMERO = /^\s*[−-]?\$?[\d.,]+\s*(?:%|u\.?)?\s*$/;
  var ANIO = /^\s*(?:19|20)\d\d\s*$/;
  // Un número suelto, no pegado a letras: «548» sí, «W1500A» o «T06» no.
  var NUMEROS = /(?<![\p{L}\d.,/-])\d[\d.,]*(?![\p{L}\d])/gu;

  /** ¿El texto entero es una cifra? En una celda, cualquiera; fuera, no un puesto («3»). */
  function esCifra(texto, enCelda) {
    return NUMERO.test(texto) && !ANIO.test(texto) && (enCelda || /\d\D*\d|%|u/.test(texto));
  }

  /**
   * Los trozos de un texto suelto que hay que tapar, como [inicio, fin]. En una
   * baldosa (`conNumeros`), también cada número suelto.
   */
  function trozos(texto, conNumeros) {
    var out = [];
    var reglas = conNumeros ? [SUELTOS, NUMEROS] : [SUELTOS];
    for (var i = 0; i < reglas.length; i++) {
      reglas[i].lastIndex = 0;
      for (var m; (m = reglas[i].exec(texto)); ) out.push([m.index, m.index + m[0].length]);
    }
    // Ordenados y sin solaparse: un rango dentro de otro pintaría dos veces.
    out.sort(function (a, b) {
      return a[0] - b[0];
    });
    var hasta = -1;
    return out.filter(function (t) {
      if (t[0] < hasta) return false;
      hasta = t[1];
      return true;
    });
  }

  // Sin documento, para los tests: solo las reglas.
  if (typeof document === 'undefined') {
    global.tapado = { trozos: trozos, COLUMNAS: COLUMNAS, esCifra: esCifra };
    return;
  }

  var raiz = document.documentElement;
  if (typeof Highlight === 'undefined' || !CSS.highlights) {
    // Un navegador viejo: sin resaltados no hay forma fina de tapar. El CSS
    // difumina el contenido entero antes que dejarlo a la vista.
    raiz.setAttribute('data-presentacion', 'sin-resaltados');
    return;
  }

  var marcas = new Highlight();
  CSS.highlights.set('tapado', marcas);
  var ENTERO = '[data-privado], .cliente-nombre, .cliente-contacto, .stat-value, .hero-cifra strong, .cat-avance-cifras strong';
  var IGNORAR = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TITLE: 1, TEXTAREA: 1 };
  /** Los rangos que se pusieron en cada texto, para cambiarlos si cambia. */
  var deNodo = new WeakMap();

  function columnaPrivada(celda) {
    var etiqueta = celda.getAttribute('data-etiqueta');
    if (etiqueta) return COLUMNAS.test(etiqueta.trim());
    var tabla = celda.closest('table');
    if (!tabla) return false;
    var fila = tabla.tHead ? tabla.tHead.rows[0] : null;
    var encabezado = fila && fila.cells[celda.cellIndex];
    return !!encabezado && COLUMNAS.test(encabezado.textContent.trim());
  }

  function todoPrivado(el, texto) {
    var marca = el.closest(ENTERO + ', [data-publico]');
    if (marca) return !marca.hasAttribute('data-publico');
    if (el.closest('[data-publico]')) return false;
    var celda = el.closest('td, tbody th');
    return esCifra(texto, !!celda) || (!!celda && columnaPrivada(celda));
  }

  function rango(nodo, inicio, fin) {
    var r = new Range();
    r.setStart(nodo, inicio);
    r.setEnd(nodo, fin);
    marcas.add(r);
    return r;
  }

  function texto(nodo) {
    var antes = deNodo.get(nodo);
    if (antes) for (var i = 0; i < antes.length; i++) marcas.delete(antes[i]);
    var el = nodo.parentElement;
    var valor = nodo.data;
    if (!el || IGNORAR[el.tagName] || !valor.trim()) return deNodo.delete(nodo);
    var puestos = [];
    if (todoPrivado(el, valor)) puestos.push(rango(nodo, 0, valor.length));
    else if (!el.closest('[data-publico]')) {
      var t = trozos(valor, !!el.closest('.stat'));
      for (var j = 0; j < t.length; j++) puestos.push(rango(nodo, t[j][0], t[j][1]));
    }
    if (puestos.length) deNodo.set(nodo, puestos);
    else deNodo.delete(nodo);
  }

  // El `title` se tapa al pasar el ratón, que es cuando se ve. Cambiarlo antes
  // haría que React lo encontrara distinto al hidratar.
  document.addEventListener(
    'pointerover',
    function (e) {
      var el = e.target.closest && e.target.closest('[title]');
      var t = el && el.getAttribute('title');
      if (!t || t === '••••') return;
      if (todoPrivado(el, '') || (!el.closest('[data-publico]') && trozos(t, false).length)) el.setAttribute('title', '••••');
    },
    true,
  );

  function recorrer(nodo) {
    if (nodo.nodeType === 3) return texto(nodo);
    if (nodo.nodeType !== 1 || IGNORAR[nodo.tagName]) return;
    var paso = document.createTreeWalker(nodo, NodeFilter.SHOW_TEXT);
    for (var n; (n = paso.nextNode()); ) texto(n);
  }

  // Los rangos de lo que se quita de la página se quedan vacíos: no pintan
  // nada, pero se limpian de vez en cuando para que el conjunto no crezca.
  var desdeLimpieza = 0;
  function limpiar() {
    marcas.forEach(function (r) {
      if (r.collapsed) marcas.delete(r);
    });
    desdeLimpieza = 0;
  }

  new MutationObserver(function (cambios) {
    for (var i = 0; i < cambios.length; i++) {
      var c = cambios[i];
      if (c.type === 'characterData') texto(c.target);
      else for (var j = 0; j < c.addedNodes.length; j++) recorrer(c.addedNodes[j]);
      desdeLimpieza += c.removedNodes ? c.removedNodes.length : 0;
    }
    if (desdeLimpieza > 500) limpiar();
  }).observe(raiz, { childList: true, subtree: true, characterData: true });

  recorrer(raiz);
})(this);
