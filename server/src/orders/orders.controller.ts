import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CancelOrderDto, CreateOrderDto, PayOrderDto, ReviewDto } from './dto.js';
import { OrdersService } from './orders.service.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  /* 用户端 */
  @Post('orders')
  create(@CurrentUser() userId: string, @Body() dto: CreateOrderDto) {
    return this.orders.create(userId, dto);
  }

  @Get('orders')
  myOrders(
    @CurrentUser() userId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.orders.myOrders(userId, status, page ? Number(page) : 1);
  }

  @Get('orders/:id')
  detail(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.orders.detail(userId, id);
  }

  @Post('orders/:id/pay')
  pay(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: PayOrderDto) {
    return this.orders.pay(userId, id, dto);
  }

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancel(userId, id, dto);
  }

  @Post('orders/:id/urge')
  urge(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.orders.urge(userId, id);
  }

  @Post('orders/:id/review')
  review(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.orders.review(userId, id, dto);
  }

  /* 玩伴端 */
  @Get('partner/orders')
  partnerOrders(@CurrentUser() userId: string, @Query('status') status?: string) {
    return this.orders.partnerOrders(userId, status);
  }

  @Post('partner/orders/:id/accept')
  accept(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.orders.partnerAct(userId, id, 'accept');
  }

  @Post('partner/orders/:id/reject')
  reject(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.orders.partnerAct(userId, id, 'reject');
  }

  @Post('partner/orders/:id/start')
  start(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.orders.partnerAct(userId, id, 'start');
  }

  @Post('partner/orders/:id/finish')
  finish(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.orders.partnerAct(userId, id, 'finish');
  }
}
