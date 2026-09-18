import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** 默认敏感词表；管理端可通过 Setting('sensitiveWords') 覆盖 */
const DEFAULT_WORDS = [
  '诈骗', '赌博', '代开发票', '枪支', '毒品', '传销',
  '兼职刷单', '裸聊', '约炮', '援交',
];

let words = [...DEFAULT_WORDS];

export async function initSensitive(prisma: PrismaService) {
  const row = await prisma.setting.findUnique({ where: { key: 'sensitiveWords' } });
  if (row?.value) words = row.value.split(/[,，\s]+/).filter(Boolean);
}

export function getSensitiveWords() {
  return words;
}

export async function setSensitiveWords(prisma: PrismaService, list: string[]) {
  words = list.length ? [...list] : [...DEFAULT_WORDS];
  await prisma.setting.upsert({
    where: { key: 'sensitiveWords' },
    create: { key: 'sensitiveWords', value: list.join(',') },
    update: { value: list.join(',') },
  });
}

export function assertClean(text: string, field = '内容') {
  const hit = words.find((w) => text.includes(w));
  if (hit) throw new BadRequestException(`${field}包含违规内容，请修改后再发`);
}
