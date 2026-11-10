import type { Request } from 'express';
import type { Types } from 'mongoose';

/**
 * Escopo de toda operação: empresa autenticada + país do header.
 * Repositórios recebem um Tenant obrigatório, o que torna impossível
 * (pelo tipo) escrever uma consulta sem escopo de empresa.
 */
export interface Tenant {
  companyId: Types.ObjectId;
  companyCode: string;
  country: string;
}

export interface TenantRequest extends Request {
  tenant?: Tenant;
}
