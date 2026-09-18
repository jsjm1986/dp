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
        lat: lat ? Number(lat) : undefined,
        lng: lng ? Number(lng) : undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
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
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 10,
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
