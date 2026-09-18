import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DynamicsController } from './dynamics/dynamics.controller.js';
import { MiscController } from './misc/misc.controller.js';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { PartnerSelfController } from './partners/partner-self.controller.js';
import { PartnersController } from './partners/partners.controller.js';
import { PartnersService } from './partners/partners.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersController } from './users/users.controller.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    UsersController,
    PartnersController,
    PartnerSelfController,
    OrdersController,
    DynamicsController,
    MiscController,
  ],
  providers: [PartnersService, OrdersService],
})
export class AppModule {}
