"""
De la tabla de la fábrica de ASTA al JSON que lee `generar.ts` (#56).

    python3 scripts/tabla-asta/extraer.py "~/Downloads/20260828 - asta硒鼓适用机型表 (1).xlsx"

La tabla («asta硒鼓适用机型表», tabla de modelos compatibles de los tóners ASTA)
trae una hoja por marca y, en cada fila, un tóner con las impresoras en las que
sirve. Esto saca SOLO las marcas que vendemos y deja el texto de las máquinas tal
cual: partirlo es trabajo de `separarModelos`, que ya existe y está probado.

Las columnas se buscan por su CABECERA, no por su letra: cada hoja las coloca en
un sitio distinto —Brother trae quince regiones y HP ninguna—, y una letra fija
se rompería a la próxima tabla que manden.

De los códigos por región se toma América: es la nuestra. El mismo tóner es
CRG-125 en Norteamérica y CRG-325 en Asia, y cargar los dos llenaría la base de
códigos que aquí no existen.

Las CELDAS COMBINADAS importan: un juego de cuatro colores comparte una sola
celda de máquinas, escrita en la fila del negro (`O25:O29`). Si no se expanden,
los tres colores se pierden —y son tres cuartas partes de un tóner de color—.
"""
import json, re, sys, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

# Hoja de la tabla → marca como está en `printer_brands`.
MARCAS = {
    'HP惠普': 'HP',
    'CANON佳能': 'Canon',
    'Brother兄弟': 'Brother',
    'SAMSUNG三星': 'Samsung',
    'EPSON爱普生': 'Epson',
    'XEROX施乐': 'Xerox',
}
# Cabeceras (fila 2, en inglés) de las columnas con el código que usamos aquí.
CODIGO = re.compile(r'^(item|short name|north america|america|latin america)$', re.I)
# Cabecera (fila 3, en chino) de la columna con las impresoras: 适用…机型.
MAQUINAS = re.compile(r'适用.*机型')
NO_SON_CODIGOS = {'bk', 'c', 'm', 'y', 'chip', '/', '★', '△'}


def combinadas(x):
    """De cada celda tapada por una combinación, a la celda que sí tiene el valor."""
    origen = {}
    for mc in x.iter(f'{NS}mergeCell'):
        desde, hasta = mc.get('ref').split(':')
        col_d, fila_d = ''.join(c for c in desde if c.isalpha()), int(''.join(c for c in desde if c.isdigit()))
        col_h, fila_h = ''.join(c for c in hasta if c.isalpha()), int(''.join(c for c in hasta if c.isdigit()))
        if col_d != col_h:
            continue  # combinaciones horizontales: son de la cabecera
        for f in range(fila_d + 1, fila_h + 1):
            origen[(col_d, f)] = (col_d, fila_d)
    return origen


def celdas_por_fila(z, destino, comp):
    x = ET.fromstring(z.read('xl/' + destino))
    for fila in x.iter(f'{NS}row'):
        celdas = {}
        for c in fila.iter(f'{NS}c'):
            col = ''.join(ch for ch in c.get('r') if ch.isalpha())
            v = c.find(f'{NS}v')
            if v is None:
                continue
            texto = comp[int(v.text)] if c.get('t') == 's' else (v.text or '')
            if texto.strip():
                celdas[col] = texto.strip()
        if celdas:
            yield fila.get('r'), celdas


def main(ruta):
    z = zipfile.ZipFile(ruta)
    comp = [''.join(t.text or '' for t in si.iter(f'{NS}t'))
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(f'{NS}si')]
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    hojas = [(h.get('name').strip(), rels[h.get(REL)])
             for h in ET.fromstring(z.read('xl/workbook.xml')).iter(f'{NS}sheet')]

    salida, descartes = [], {'universal': 0, 'sin_maquinas': 0, 'sin_codigo': 0}
    for nombre, destino in hojas:
        marca = MARCAS.get(nombre)
        if not marca:
            continue
        hoja_xml = ET.fromstring(z.read('xl/' + destino))
        origen = combinadas(hoja_xml)
        filas = list(celdas_por_fila(z, destino, comp))
        valor = {(col, int(r)): v for r, c in filas for col, v in c.items()}
        cab_en = next((c for r, c in filas if r == '2'), {})
        cab_zh = next((c for r, c in filas if r == '3'), {})
        cols_codigo = [k for k, v in cab_en.items() if CODIGO.match(v.strip())]
        col_maquinas = next((k for k, v in cab_zh.items() if MAQUINAS.search(v)), None)
        if not cols_codigo or not col_maquinas:
            print(f'  !! {nombre}: no encuentro las columnas (códigos={cols_codigo}, máquinas={col_maquinas})')
            continue

        for r, c in filas:
            if int(r) <= 4:
                continue
            # Si la celda está tapada por una combinación, el valor está arriba.
            maquinas = (c.get(col_maquinas) or valor.get(origen.get((col_maquinas, int(r)), ('', 0)), '')).strip()
            if len(maquinas) < 6 or re.fullmatch(r'[BKCMY/ ]+', maquinas):
                descartes['sin_maquinas'] += 1
                continue
            crudos = [(c.get(k) or '').strip() for k in cols_codigo]
            # Una celda con barras es un tóner UNIVERSAL: la lista de máquinas es
            # la unión de varios originales, y repartirla diría que el CE285A
            # sirve en la P1006. Se deja fuera; va a mano o por la lista del #251.
            if any('/' in v for v in crudos if v):
                descartes['universal'] += 1
                continue
            codigos = sorted({v for v in crudos if v and len(v) >= 3 and re.search(r'\d', v)
                              and v.lower() not in NO_SON_CODIGOS and len(v) <= 40})
            if not codigos:
                descartes['sin_codigo'] += 1
                continue
            salida.append({'marca': marca, 'hoja': nombre, 'fila': int(r), 'codigos': codigos, 'maquinas': maquinas})

    destino_json = Path(__file__).with_name('tabla-asta.json')
    destino_json.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding='utf8')
    print(f'{len(salida)} filas útiles → {destino_json.name}')
    for marca in sorted({f["marca"] for f in salida}):
        print(f'   {sum(1 for f in salida if f["marca"] == marca):4}  {marca}')
    print(f'descartadas: {descartes}')


if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else '').expanduser())
