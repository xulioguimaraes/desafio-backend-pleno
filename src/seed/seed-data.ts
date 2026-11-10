/**
 * Empresas de teste. Os segredos em claro ficam aqui (e no README) de propósito:
 * são credenciais de desenvolvimento. No banco só vai o hash.
 * O seed nunca imprime os segredos no log.
 */
export const SEED_COMPANIES = [
  {
    code: 'acme',
    name: 'Acme Apostas',
    public_key: 'ck_live_acme',
    secret: 'cs_live_acme_9f3b2c7d1e',
  },
  {
    code: 'globex',
    name: 'Globex Rifas',
    public_key: 'ck_live_globex',
    secret: 'cs_live_globex_4a8e6f0b2d',
  },
] as const;
