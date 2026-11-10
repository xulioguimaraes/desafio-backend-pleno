# Loyalty Events API

API de ingestão de eventos de fidelidade, multi-tenant, com **idempotência em três camadas** e **efeito exatamente uma vez** nas métricas.

Stack: NestJS 11 + TypeScript · MongoDB 7 (Mongoose 8, replica set) · Redis 7 + Bull · Jest.

---

## Como rodar

```bash
docker compose up --build
```

Sobe Mongo (replica set de 1 nó), Redis e a API em `http://localhost:3000`. O seed roda a cada subida (é idempotente) e cria duas empresas:

| Empresa | `x-company-key` | `x-company-secret` |
|---|---|---|
| acme | `ck_live_acme` | `cs_live_acme_9f3b2c7d1e` |
| globex | `ck_live_globex` | `cs_live_globex_4a8e6f0b2d` |

São credenciais de desenvolvimento. No banco só existe o hash.

```bash
curl -X POST localhost:3000/v1/events \
  -H 'content-type: application/json' \
  -H 'x-company-key: ck_live_acme' -H 'x-company-secret: cs_live_acme_9f3b2c7d1e' -H 'x-country-code: BR' \
  -d '{"event_id":"evt_01HZX9","action":"DEPOSIT_CONFIRMED","client_id":"c_42","amount":"19.74","occurred_at":"2026-11-07T23:30:00-03:00","metadata":{"channel":"pix"}}'
```

### Testes

```bash
npm install
npm test                    # unitários (sem dependências externas)
npm run test:integration    # integração: sobe Mongo e Redis reais via Testcontainers (precisa de Docker)
npm run load                # carga C2, C5 e C11 contra a API rodando (docker compose up antes)
```

Para rodar a integração contra containers já existentes em vez do Testcontainers:
`TEST_MONGO_URI="mongodb://localhost:27017/loyalty_test?replicaSet=rs0&directConnection=true" npm run test:integration`.

### Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `QUEUE_CONCURRENCY` | 10 | concorrência do consumidor Bull por instância |
| `DEDUP_WINDOW_MS` | 10000 | janela da camada 2 |
| `MAX_ATTEMPTS` | 3 | tentativas antes de `FAILED` |
| `BACKOFF_DELAY_MS` | 1000 | base do backoff exponencial (1s, 2s, ...) |
| `PROCESSING_LEASE_MS` | 30000 | por quanto tempo um worker "possui" um evento |
| `RECOVERY_INTERVAL_MS` | 15000 | intervalo da varredura de recuperação (0 desliga) |
| `RECOVERY_PENDING_AGE_MS` | 30000 | idade mínima de um `PENDING` para ser reenfileirado |
| `ENQUEUE_TIMEOUT_MS` | 1000 | espera máxima pelo Redis no POST |
| `MONGO_URI`, `REDIS_HOST`, `REDIS_PORT`, `PORT`, `LOG_LEVEL` | | conexões e log |

---

## Arquitetura

```
src/
  domain/        regras puras, sem Nest: dinheiro, datas, impressão digital
  actions/       uma strategy por action + registry
  tenancy/       autenticação da empresa, Tenant obrigatório em toda consulta
  events/        POST e GET de eventos (validação, use-cases, repositório)
  queue/         enfileiramento no Bull
  processing/    worker, use-case de processamento, varredura de recuperação
  metrics/       client_kpi_state, report_daily, consultas
  common/        erros {code,message}, filtro HTTP, transações, logging
```

Fluxo: `controller → use-case → repositório`. Controllers só traduzem HTTP. Use-cases têm a regra. Repositórios são os únicos que falam com o Mongo, e **todo método de leitura recebe um `Tenant`**: não existe consulta sem escopo de empresa.

**Mongo é a fonte da verdade, Redis é só gatilho.** O estado do evento (`PENDING → PROCESSING → PROCESSED | FAILED`) vive no Mongo. Se um job se perder no Redis, a varredura o recria a partir do Mongo.

---

## Idempotência em três camadas

### Camada 1 — por `event_id` (permanente)

- **Mecanismo:** índice único `{company_id, event_id}` em `events`.
- **Fluxo:** um `findOne` rápido responde reenvios sequenciais. Em requisições simultâneas, todas passam pelo `findOne`, mas só uma consegue inserir; as outras recebem `E11000`, releem o original e comparam o `payload_hash`:
  - hash igual → `200 DUPLICATE_EVENT_ID` com o id e o **status atual**;
  - hash diferente → `409 IDEMPOTENCY_CONFLICT`.
- **Por quê:** a garantia mora no banco, então sobrevive a restart do Redis, a várias instâncias e a qualquer corrida. Não há lock em memória.
- **Conteúdo comparado** (`payload_hash`): país, client_id, action, amount em centavos, occurred_at em epoch ms e metadata com chaves ordenadas. Ver "Decisões" para país e metadata.
- Há um teste com a janela de conteúdo **zerada** (camada 2 desligada): os 50 simultâneos continuam dando 1 × 202. Isso prova que a camada 1 funciona sozinha.

### Camada 2 — por conteúdo (janela de 10s)

- **Impressão digital:** `sha256(JSON([empresa, país, client_id, action, centavos, epoch_ms]))`.
  - `"19.7"` e `"19.70"` viram `1970`. O mesmo instante em qualquer fuso vira o mesmo epoch.
  - LOGIN entra com amount `null`, de forma consistente. Metadata fica de fora.
  - Serializar como array JSON (e não `a|b|c`) impede colisão quando um campo contém o separador.
- **Reserva atômica** na coleção `event_fingerprints` (`_id` = impressão digital):
  ```js
  updateOne({ _id: fp, expires_at: { $lte: now } },
            { $set: { event_ref, expires_at: now + janela } },
            { upsert: true })
  ```
  - Não existe → insere.
  - Existe e venceu → toma a reserva.
  - Existe e está na janela → o filtro não casa, o upsert tenta inserir o mesmo `_id` → `E11000` → `200 DUPLICATE_CONTENT` com o id do original.
- **A janela é medida pelo relógio do servidor no aceite**, não pelo `occurred_at`. O TTL index do Mongo é só limpeza: ele roda a cada ~60s, então a janela nunca depende dele (a comparação com `expires_at` está na query).
- **C10 (falha depois da reserva):** a reserva e a inserção do evento estão na **mesma transação**. Se a inserção falhar, a transação aborta e a reserva desaparece junto. Não existe reserva órfã bloqueando reenvios.
- **Por que Mongo e não `SET NX` no Redis?** Com o Redis, a reserva e a gravação do evento ficariam em dois sistemas sem atomicidade: uma falha entre os dois deixaria lixo, e o C16 (Redis fora) derrubaria a camada 2. Com tudo no Mongo, as duas camadas ficam numa transação só.

### Camada 3 — no processamento (efeito exatamente uma vez)

1. **Claim atômico:** um `findOneAndUpdate` passa o evento de `PENDING` (ou `PROCESSING` com posse vencida) para `PROCESSING`, grava um `lock_token` único e define `locked_until`. Dois workers com o mesmo evento (C13): só um recebe o documento, o outro sai com `SKIPPED`.
2. **Transação:** `status = PROCESSED` (condicionado ao `lock_token`) + `$inc`/`$min`/`$max` nas métricas, tudo na mesma transação.
   - Se o job morrer no meio (C12), nada foi aplicado.
   - Se a posse venceu e outro worker assumiu, a condição do `lock_token` falha e a transação aborta.
   - Nunca existe "métrica aplicada com evento ainda pendente".
3. **Falha:** volta para `PENDING` com `last_error` e o Bull tenta de novo (backoff exponencial). Na 3ª tentativa vira `FAILED` com o motivo.
4. **Recuperação** (`RecoveryService`, a cada 15s, em todas as instâncias):
   - reenfileira `PENDING` antigos e `PROCESSING` com posse vencida;
   - marca `FAILED` quem esgotou as tentativas.
   - Reenfileirar é seguro: `jobId = id do evento` evita job duplicado na fila, e o claim + transação evitam efeito duplicado.

> **Pegadinha do Bull:** com `removeOnComplete/removeOnFail = false`, um `add` com um `jobId` que já existe no histórico é **ignorado em silêncio**, e a recuperação nunca reprocessaria. Por isso os jobs são removidos ao terminar.

**Strategies:** cada action é uma classe (`actions/strategies.ts`) que diz se exige amount e quanto contribui nas métricas. Para adicionar uma action, basta criar a classe e incluí-la na lista de `ActionsModule`. Consumidor, use-case de processamento e validador não mudam: o validador pergunta à strategy se o amount é obrigatório.

---

## Cenários de falha

| Situação | O que acontece |
|---|---|
| **Redis fora no POST (C16)** | O evento é gravado no Mongo (`PENDING`). O enqueue tem timeout de 1s (o ioredis seguraria o comando indefinidamente na fila offline). A resposta é **202**. Quando o Redis volta, a varredura enfileira. Reenvios durante a queda continuam idempotentes, porque as camadas 1 e 2 estão no Mongo. **Por que 202 e não 503:** o fato foi aceito de forma durável. Um 503 faria o operador reenviar, o que só geraria duplicatas (inofensivas, mas inúteis). Nunca há efeito duplicado. |
| **Redis fora durante o processamento** | Workers param de receber jobs. Eventos ficam `PENDING`/`PROCESSING` no Mongo e são recuperados pela varredura quando o Redis volta. O AOF do Redis está ligado, mas não dependemos dele. |
| **Redis reinicia e perde jobs** | Mesmo caso: a varredura recria os jobs a partir do Mongo. |
| **Mongo fora no POST** | Seleção de servidor falha em até 5s → **503 `SERVICE_UNAVAILABLE`**. Nada é enfileirado, porque o enqueue só acontece depois do commit. |
| **Mongo falha no meio do POST (C10)** | A transação aborta (reserva + evento). → 503. O reenvio é aceito na hora. |
| **Mongo fora durante o processamento** | A transação falha → o evento volta para `PENDING` → o Bull tenta de novo com backoff → `FAILED` depois de 3 tentativas. Pode ser reprocessado depois (ver "Com mais tempo"). |
| **Worker morre no meio do job** | Se morreu antes do commit, nada foi aplicado. O evento fica `PROCESSING` até `locked_until` vencer, e então a varredura reenfileira e outro worker assume. Se morreu depois do commit, o evento já está `PROCESSED` e reprocessar dá `SKIPPED`. |
| **Worker lento perde a posse** | Outro worker assume. Quando o lento tentar commitar, a condição `lock_token` falha e ele aborta sem efeito. |
| **Várias instâncias** | Nenhum estado em memória participa de uma garantia. Índices únicos, claim atômico e transações vivem no Mongo. Validado com 2 instâncias na mesma fila (C11 exato). |

---

## Índices

| Coleção | Índice | Sustenta |
|---|---|---|
| `events` | `{company_id, event_id}` **único** | Camada 1 (permanente, concorrência). Também atende a busca por event_id. |
| `events` | `{status, updated_at}` | Varredura de recuperação (`PENDING` antigos, `PROCESSING` vencidos). |
| `events` | `_id` (padrão) | `GET /v1/events/:id`. O filtro adicional de empresa/país é aplicado no documento único. |
| `event_fingerprints` | `_id` (= impressão digital) | Camada 2: reserva atômica via unicidade do `_id`. |
| `event_fingerprints` | `{expires_at}` TTL 60s | Só limpeza de reservas vencidas. A janela não depende dele. |
| `client_kpi_state` | `{company_id, country, client_id}` **único** | Upsert do worker (um documento por cliente) e `GET /clients/:id/metrics`. |
| `report_daily` | `{company_id, country, day}` **único** | Upsert do worker e range de dias do relatório (uma consulta só). |
| `report_daily_clients` | `{company_id, country, day, client_id}` **único** | Clientes únicos por dia: o upsert retorna `upsertedCount = 1` só na primeira aparição. |
| `companies` | `{public_key}` **único**, `{code}` **único** | Autenticação por `x-company-key`. |

Os índices são criados no boot, e a API **espera todos ficarem prontos** antes de aceitar tráfego (`bootstrap.ts`). Sem isso, uma rajada logo após o primeiro deploy chegaria antes do índice único e aceitaria duplicatas.

---

## Dinheiro, fuso e ordem

- **Centavos inteiros sempre.** O `amount` é convertido de string para `bigint` manipulando texto (`"19.7"` → `1970n`), nunca `parseFloat`. É persistido como **Int64 (`Long`)** no BSON. Atenção: um `Number` do Mongoose seria gravado como *double*. As somas usam `$inc` com Int64.
- **Formato do amount:** inteiro sem zeros à esquerda + até 2 casas, > 0, até 13 dígitos inteiros. `"019.70"`, `".5"`, `"1e2"`, `"19,70"` e números JSON (não string) são rejeitados.
- **`occurred_at` exige fuso.** `"2026-11-07T23:30:00"` é rejeitado: o JS aceitaria e interpretaria no fuso do servidor. Datas impossíveis (`2026-02-30`) também são rejeitadas.
- **Dia do relatório em `America/Sao_Paulo`** via base IANA (Luxon), não `-03:00` fixo. Se o horário de verão voltar, continua certo.
- **Fora de ordem:** `$min` para `first_at` e `$max` para `last_at`, nunca `$set`.
- **Sem lost update:** só operadores atômicos do servidor (`$inc`, `$min`, `$max`), nunca "ler → somar → gravar".

---

## Segurança

- **Segredo:** guardado como SHA-256 e comparado com `timingSafeEqual`. Quando a key não existe, a comparação roda contra um hash falso, para que "key inexistente" e "segredo errado" levem o mesmo tempo.
  - **Por que não bcrypt:** os segredos são gerados pela plataforma (alta entropia). Força bruta sobre SHA-256 é inviável nesse caso, e bcrypt custaria dezenas de ms em **cada** requisição (o C11 manda 1.000).
- **Logs:** o serializer de request só expõe método, URL e id. **Headers nunca são logados**, e há `redact` como segunda barreira. Logs têm `company_code`, `event_id` e `latency_ms`. Mensagens de erro 5xx logam só nome e mensagem.
- **Isolamento:** toda consulta filtra por `company_id` e, onde o modelo tem país, por `country`. Evento de outra empresa → 404 (não 403, para não revelar que existe).
- **Metadata:** chaves começando com `$` ou contendo `.` são rejeitadas (seriam interpretadas como operadores/caminhos pelo Mongo).

---

## Decisões sobre pontos ambíguos

1. **Camada 1 e país:** a unicidade é `(empresa, event_id)`, como diz o enunciado, sem país. O país entra no `payload_hash`, então o mesmo `event_id` vindo de outro país é "conteúdo diferente" → 409.
2. **Metadata na camada 1:** entra no `payload_hash`. Mesmo `event_id` com metadata diferente → 409, porque é outro payload. Na camada 2 o metadata fica de fora, como pede o enunciado.
3. **Concorrência no C2:** as 49 requisições perdedoras respondem `DUPLICATE_EVENT_ID` (não `DUPLICATE_CONTENT`), porque o `event_id` é o mesmo.
4. **Redis fora no POST:** 202 (ver tabela de falhas).
5. **`x-country-code`:** precisa ter 2 letras (`/^[A-Z]{2}$/`, maiúsculas/minúsculas aceitas). Não há lista de países permitidos por empresa. Header ausente ou inválido → 401.
6. **Cliente sem métricas:** `GET /clients/:id/metrics` → `404 CLIENT_NOT_FOUND`.
7. **Relatório:** `from` e `to` inclusivos, no máximo 31 dias contando os dois extremos. Retorna só os dias com movimento.
8. **`amount` em LOGIN:** proibido inclusive como `null` → `INVALID_AMOUNT`.
9. **Campos desconhecidos no body:** ignorados (compatibilidade futura).
10. **`/health`:** sem autenticação, para healthchecks de infraestrutura.
11. **`total_cents` de LOGIN:** fica 0 (ação não financeira).
12. **Tentativas:** "3 tentativas" = 3 execuções no total. O contador `attempts` no Mongo é a fonte da verdade (o do Bull se perde se o job for recriado pela varredura).

---

## Mapa cenário → teste

| # | Teste |
|---|---|
| C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C16 | `test/ingestion.e2e-spec.ts` |
| C11, C12, C13, C14, C15 + worker morto, posse válida, FAILED após 3 | `test/processing.e2e-spec.ts` |
| Normalização da impressão digital, dinheiro, datas, validação, strategies | `src/**/*.spec.ts` |
| Carga C2, C5, C11 (esperado × obtido) | `scripts/load.ts` (`npm run load`) |

Os testes de integração sobem o **mesmo `AppModule` de produção** com HTTP real, Mongo replica set e Redis reais. As falhas são simuladas com `jest.spyOn`: insert falhando no C10, `addBulk` que nunca responde no C16 e falha no meio do efeito no C12.

---

## Bibliotecas não óbvias

- **luxon:** fusos IANA (`America/Sao_Paulo`) e validação estrita de datas ISO.
- **nestjs-pino / pino-http:** logs JSON estruturados com serializers e redact.
- **testcontainers:** Mongo replica set e Redis reais e descartáveis nos testes, sem depender de ambiente pré-configurado.
- **tsx:** roda o script de carga em TypeScript sem compilar (ele não usa decorators).

---

## Trade-offs e o que faria com mais tempo

- **Transações têm custo.** Com 1.000 eventos no mesmo cliente, as transações disputam o mesmo documento (`WriteConflict`) e o driver repete. É correto, mas limita a vazão por cliente "quente". Com mais tempo: agregação em lote por cliente (um job aplica N eventos numa transação) ou contadores particionados.
- **Varredura em todas as instâncias:** é simples e segura (idempotente), mas faz consultas redundantes. Com mais tempo: eleição de líder ou lock distribuído só para a varredura.
- **Relógios:** a janela de 10s usa o relógio da instância. Clock skew entre instâncias desloca a janela em alguns ms. Usar `$$NOW` do Mongo eliminaria isso.
- **Transactional outbox completo:** hoje o "outbox" é o próprio `status = PENDING` + varredura, com latência de até `RECOVERY_PENDING_AGE_MS` quando o Redis falha. Um change stream no Mongo reduziria essa latência.
- **Reprocessar `FAILED`:** um endpoint administrativo para recolocar eventos `FAILED` na fila (depois de corrigir a causa).
- **`total_cents` como string** nas respostas, para somas acima de 2^53 centavos (~R$ 90 trilhões; hoje é `number`).
- **Observabilidade:** métricas Prometheus (fila, latência, duplicatas por camada), tracing e um dashboard Bull Board.
- **Rate limiting por empresa** e lista de países permitidos por empresa.
- **Migrar para BullMQ** (o Bull está em modo manutenção). Mantive o Bull porque é a stack obrigatória do desafio.
