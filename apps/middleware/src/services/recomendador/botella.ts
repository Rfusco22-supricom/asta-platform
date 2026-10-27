/**
 * ¿Es una botella de tinta, y no un cartucho?
 *
 * En el catálogo las dos son `TINTA` (y alguna botella, `OTRO`), pero para el
 * cliente no son lo mismo: el de una EcoTank pide «la tinta», el de una DeskJet
 * pide «el cartucho». La familia sale del código, que es de cada fabricante:
 *
 *   · Epson: las EcoTank, T + tres cifras de las series 5 y 6 («T544», «T664»,
 *     también sin la T), y las T49x de las SureColor de sublimación. Los
 *     cartuchos de Epson llevan otros códigos («T941», «748XXL»).
 *   · HP: las Smart Tank, GT51–GT53 y 31/32XL.
 *   · Canon: las GI- de las PIXMA G.
 *   · Brother: las BT y BTD de las InkBenefit Tank.
 *
 * Ante la duda, cartucho: decirle «tinta» a quien necesita un cartucho es el
 * error que se quiere evitar.
 */
const BOTELLAS: Record<string, RegExp> = {
  epson: /^(T?[56]\d\d|T49[A-Z])$/,
  hp: /^(GT5\d|31|32XL)$/,
  canon: /^GI\d+$/,
  brother: /^BTD?\d+/,
};

export function esBotella(marca: string, codigo: string): boolean {
  const patron = BOTELLAS[marca.trim().toLowerCase()];
  return patron ? patron.test(codigo.toUpperCase().replace(/[^A-Z0-9]/g, '')) : false;
}
