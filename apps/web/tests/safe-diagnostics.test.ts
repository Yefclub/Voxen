import { describe, expect, test } from 'bun:test';
import { safeErrorDiagnostic } from '../src/lib/safe-diagnostics';

describe('diagnóstico seguro de erros', () => {
  test('expõe somente código interno e tipo normalizado', () => {
    const secret =
      'Cliente-Acme-Fusao-Secreta.pdf socks5h://usuario:senha@proxy Bearer sk-or-secret';
    const diagnostic = safeErrorDiagnostic('UPLOAD_STORE_FAILED', new Error(secret));

    expect(diagnostic).toEqual({
      error_code: 'UPLOAD_STORE_FAILED',
      error_type: 'Error',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('Cliente-Acme');
    expect(JSON.stringify(diagnostic)).not.toContain('senha');
    expect(JSON.stringify(diagnostic)).not.toContain('sk-or-secret');
  });

  test('normaliza código e nome fora do contrato', () => {
    const error = new Error('segredo');
    error.name = 'ClienteAcmeFusaoSecretaPdf';

    expect(safeErrorDiagnostic('código inválido', error)).toEqual({
      error_code: 'UNEXPECTED_FAILURE',
      error_type: 'UnknownError',
    });
    expect(JSON.stringify(safeErrorDiagnostic('código inválido', error))).not.toContain(
      'ClienteAcme',
    );
  });
});
