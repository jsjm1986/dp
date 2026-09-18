import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, OptionalAuthGuard } from '../auth/jwt-auth.guard.js';
import { toInt, toNum } from '../common/params.js';
import { PartnersService } from './partners.service.js';

@Controller('partners')
export class PartnersController {
  constructor(private partners: PartnersService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  list(
    @CurrentUser() userId: string | undefined,
    @Query('city') city?: string,
    @Query('keyword') keyword?: string,
    @Query('sort') sort?: 'default' | 'newest' | 'rating' | 'distance',
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.partners.list(
      {
        city,
        keyword,
        sort,
        lat: toNum(lat),
        lng: toNum(lng),
        page: toInt(page, { min: 1 }),
        pageSize: toInt(pageSize, { min: 1, max: 50 }),
      },
      userId,
    );
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  detail(@Param('id') id: string, @CurrentUser() userId?: string) {
    return this.partners.detail(id, userId);
  }

  @Get(':id/reviews')
  reviews(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.partners.reviews(
      id,
      toInt(page, { def: 1, min: 1 }) ?? 1,
      toInt(pageSize, { def: 10, min: 1, max: 50 }) ?? 10,
    );
  }

  @Post(':id/follow')
  @UseGuards(JwtAuthGuard)
  follow(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.partners.follow(userId, id);
  }

  @Delete(':id/follow')
  @UseGuards(JwtAuthGuard)
  unfollow(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.partners.unfollow(userId, id);
  }
}
