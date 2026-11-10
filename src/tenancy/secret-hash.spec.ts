import { hashSecret, verifySecret } from './secret-hash';

describe('secret-hash', () => {
  const stored = hashSecret('cs_live_xyz');

  it('não guarda o segredo em claro', () => {
    expect(stored).not.toContain('cs_live_xyz');
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('aceita o segredo correto', () => {
    expect(verifySecret('cs_live_xyz', stored)).toBe(true);
  });

  it('rejeita segredo errado', () => {
    expect(verifySecret('cs_live_xyZ', stored)).toBe(false);
  });

  it('rejeita quando a empresa não existe (sem hash), mesmo comparando contra um hash falso', () => {
    expect(verifySecret('__dummy_secret_never_valid__', undefined)).toBe(false);
    expect(verifySecret('qualquer', undefined)).toBe(false);
  });
});
