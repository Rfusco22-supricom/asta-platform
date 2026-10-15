import { describe, expect, it } from 'vitest';
import { motivoSmtp, pistaSmtp } from '../services/correo.service.js';

/**
 * #46 · Por qué rechazó el SMTP, sin datos personales.
 *
 * Producción solo registraba «fallo al enviar el correo, codigo 535», y las
 * alertas, los reseteos y las invitaciones dejaban de llegar sin que se supiera
 * por qué. Las respuestas son las que da Gmail de verdad.
 */

describe('#46 · El motivo del rechazo', () => {
  it('Gmail 535: se queda el motivo, en una línea', () => {
    const error = {
      responseCode: 535,
      response:
        '535-5.7.8 Username and Password not accepted. For more information, go to\n535 5.7.8  https://support.google.com/mail/?p=BadCredentials 5b1f17b1804b1-43e4d5 - gsmtp',
    };
    const { codigo, motivo } = motivoSmtp(error);
    expect(codigo).toBe(535);
    expect(motivo).toMatch(/^535-5\.7\.8 Username and Password not accepted\. For more information, go to 5\.7\.8 https:\/\/support\.google\.com/);
    expect(motivo).not.toContain('\n');
    expect(pistaSmtp(codigo, motivo)).toMatch(/CONTRASEÑA DE APLICACIÓN/);
  });

  it('una dirección en la respuesta no llega al log', () => {
    const { motivo } = motivoSmtp({ responseCode: 550, response: '550 5.1.1 <alguien@cliente.com> user unknown' });
    expect(motivo).toBe('550 5.1.1 <dirección> user unknown');
    expect(motivo).not.toContain('@');
  });

  it('sin respuesta del servidor: el código de red, y la pista de host y puerto', () => {
    const { codigo, motivo } = motivoSmtp({ code: 'ETIMEDOUT' });
    expect([codigo, motivo]).toEqual(['ETIMEDOUT', null]);
    expect(pistaSmtp(codigo, motivo)).toMatch(/SMTP_HOST y SMTP_PORT/);
  });

  it('lo que no se reconoce no inventa una pista', () => {
    expect(pistaSmtp(421, '421 4.7.0 Try again later')).toBeNull();
    expect(motivoSmtp(new Error('raro'))).toEqual({ codigo: 'desconocido', motivo: null });
  });
});
