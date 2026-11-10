import mongoose from 'mongoose';
import { loadConfig } from '../config/app-config';
import { CompanySchema } from '../tenancy/company.schema';
import { hashSecret } from '../tenancy/secret-hash';
import { SEED_COMPANIES } from './seed-data';

/** Upsert idempotente: pode rodar a cada `docker compose up`. */
export async function seedCompanies(connection: mongoose.Connection): Promise<void> {
  const Company = connection.model('Company', CompanySchema);
  await Company.init();

  await Company.bulkWrite(
    SEED_COMPANIES.map((c) => ({
      updateOne: {
        filter: { public_key: c.public_key },
        update: {
          $set: { code: c.code, name: c.name, secret_hash: hashSecret(c.secret), active: true },
        },
        upsert: true,
      },
    })),
  );
}

async function main() {
  const config = loadConfig();
  const connection = await mongoose.createConnection(config.mongoUri).asPromise();
  try {
    await seedCompanies(connection);
    console.log(
      JSON.stringify({
        msg: 'seed concluído',
        companies: SEED_COMPANIES.map((c) => c.code),
      }),
    );
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ msg: 'seed falhou', err_message: (err as Error).message }));
    process.exit(1);
  });
}
