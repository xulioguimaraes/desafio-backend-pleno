import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'companies', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Company {
  /** Código curto usado nos logs (company_code). */
  @Prop({ required: true, unique: true })
  code: string;

  @Prop({ required: true })
  name: string;

  /** x-company-key. Índice único: é por ele que a autenticação busca a empresa. */
  @Prop({ required: true, unique: true })
  public_key: string;

  /** SHA-256 (hex) do x-company-secret. O segredo em claro nunca é guardado. */
  @Prop({ required: true, select: false })
  secret_hash: string;

  @Prop({ default: true })
  active: boolean;
}

export type CompanyDocument = HydratedDocument<Company>;
export const CompanySchema = SchemaFactory.createForClass(Company);
