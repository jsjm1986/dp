import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto, SendSmsDto } from './dto.js';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('sms/send')
  sendSms(@Body() dto: SendSmsDto) {
    return this.auth.sendSms(dto.mobile);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.mobile, dto.code, dto.inviteCode);
  }
}
