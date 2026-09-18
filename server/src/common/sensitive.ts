import { BadRequestException } from '@nestjs/common';

/** 演示用敏感词表，生产应接入内容安全服务 */
const SENSITIVE_WORDS = [
  '诈骗', '赌博', '代开发票', '枪支', '毒品', '传销',
  '兼职刷单', '裸聊', '约炮', '援交',
];

export function assertClean(text: string, field = '内容') {
  const hit = SENSITIVE_WORDS.find((w) => text.includes(w));
  if (hit) throw new BadRequestException(`${field}包含违规内容，请修改后再发`);
}
