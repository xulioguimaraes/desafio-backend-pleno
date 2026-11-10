import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, CompanySchema } from './company.schema';
import { TenantAuthGuard } from './tenant-auth.guard';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: Company.name, schema: CompanySchema }])],
  providers: [TenantAuthGuard],
  exports: [TenantAuthGuard, MongooseModule],
})
export class TenancyModule {}
