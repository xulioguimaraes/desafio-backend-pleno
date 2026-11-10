import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppError } from '../common/errors/app-error';
import { Company } from './company.schema';
import { verifySecret } from './secret-hash';
import type { TenantRequest } from './tenant';

const COUNTRY_CODE = /^[A-Z]{2}$/;

function header(req: TenantRequest, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Autentica a empresa pelos headers e anexa o Tenant à requisição.
 * Qualquer header ausente ou inválido → 401 UNAUTHORIZED (sem dizer qual).
 */
@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(@InjectModel(Company.name) private readonly companies: Model<Company>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantRequest>();

    const key = header(req, 'x-company-key');
    const secret = header(req, 'x-company-secret');
    const country = header(req, 'x-country-code')?.toUpperCase();

    if (!key || !secret || !country || !COUNTRY_CODE.test(country)) {
      throw AppError.unauthorized();
    }

    const company = await this.companies
      .findOne({ public_key: key, active: true })
      .select('+secret_hash code')
      .lean();

    // verifySecret roda mesmo se a empresa não existir (tempo constante).
    if (!verifySecret(secret, company?.secret_hash) || !company) {
      throw AppError.unauthorized();
    }

    req.tenant = { companyId: company._id, companyCode: company.code, country };
    return true;
  }
}
