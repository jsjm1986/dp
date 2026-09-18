import { IsMobilePhone, IsOptional, IsString, Length } from 'class-validator';

export class SendSmsDto {
  @IsMobilePhone('zh-CN')
  mobile: string;
}

export class LoginDto {
  @IsMobilePhone('zh-CN')
  mobile: string;

  @IsString()
  @Length(4, 8)
  code: string;

  @IsOptional()
  @IsString()
  inviteCode?: string;
}
