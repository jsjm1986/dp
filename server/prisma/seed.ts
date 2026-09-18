import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/generated/prisma/client.js';

const UPLOADS = join(process.cwd(), 'uploads', 'seed');
mkdirSync(UPLOADS, { recursive: true });

const PALETTES: Array<[string, string]> = [
  ['#FF9A9E', '#FECFEF'],
  ['#A18CD1', '#FBC2EB'],
  ['#84FAB0', '#8FD3F4'],
  ['#FFD1FF', '#FAD0C4'],
  ['#F6D365', '#FDA085'],
  ['#5EE7DF', '#B490CA'],
  ['#96E6A1', '#D4FC79'],
  ['#E0C3FC', '#8EC5FC'],
];

function svgAvatar(name: string, i: number) {
  const [c1, c2] = PALETTES[i % PALETTES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="122" font-size="72" text-anchor="middle" fill="rgba(255,255,255,.92)" font-family="PingFang SC, sans-serif">${name[0]}</text></svg>`;
}

function svgPhoto(title: string, i: number, k: number) {
  const [c1, c2] = PALETTES[(i + k) % PALETTES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="600" height="800" fill="url(#g)"/><circle cx="${120 + k * 130}" cy="200" r="90" fill="rgba(255,255,255,.25)"/><circle cx="${480 - k * 80}" cy="560" r="140" fill="rgba(255,255,255,.18)"/><text x="300" y="740" font-size="40" text-anchor="middle" fill="rgba(255,255,255,.9)" font-family="PingFang SC, sans-serif">${title}</text></svg>`;
}

function svgBanner(title: string, sub: string, i: number) {
  const [c1, c2] = PALETTES[i % PALETTES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="750" height="360" rx="24" fill="url(#g)"/><text x="48" y="150" font-size="56" fill="#fff" font-weight="bold" font-family="PingFang SC, sans-serif">${title}</text><text x="48" y="220" font-size="30" fill="rgba(255,255,255,.85)" font-family="PingFang SC, sans-serif">${sub}</text></svg>`;
}

function save(name: string, svg: string) {
  writeFileSync(join(UPLOADS, name), svg);
  return `/uploads/seed/${name}`;
}

const PARTNERS = [
  { name: '林小满', gender: 'female', city: '上海', district: '徐汇区', age: 23, height: 168, weight: 48, constellation: '双子座', education: '本科', tags: ['拍照陪玩', '城市漫步', '美食探店', '打卡攻略'], bio: '土生土长上海姑娘，摄影爱好者，带你逛最地道的弄堂和咖啡馆，包出片。', lat: 31.1885, lng: 121.4368, services: [['城市陪同漫步', 99, '小时', 2], ['陪拍+精修9图', 299, '次', 1], ['美食探店带路', 129, '小时', 2], ['全天陪同', 699, '天', 1]] },
  { name: '陆垚', gender: 'male', city: '上海', district: '静安区', age: 24, height: 183, weight: 72, constellation: '狮子座', education: '本科', tags: ['剧本杀', '密室逃脱', '运动陪伴', 'ENFP'], bio: '服表生，幽默话多话少随意切换，有驾照可接送。', lat: 31.2304, lng: 121.4594, services: [['休闲陪同', 100, '小时', 2], ['剧本杀/密室组队', 150, '小时', 2], ['全天陪同', 800, '天', 1]] },
  { name: '苏晚', gender: 'female', city: '北京', district: '朝阳区', age: 26, height: 170, weight: 50, constellation: '天秤座', education: '硕士', tags: ['博物馆讲解', '胡同漫步', '陪拍', '咖啡'], bio: '文博专业出身，故宫国博讲解不在话下，也能陪你喝遍北京咖啡馆。', lat: 39.9219, lng: 116.4435, services: [['博物馆陪同讲解', 168, '小时', 2], ['胡同Citywalk', 128, '小时', 2], ['陪拍', 259, '次', 1]] },
  { name: '陈默', gender: 'male', city: '北京', district: '东城区', age: 28, height: 178, weight: 70, constellation: '摩羯座', education: '本科', tags: ['夜跑陪伴', '钓鱼', '爬山', '话少'], bio: '互联网从业者，周末化身户外搭子，钓鱼爬山骑行样样行。', lat: 39.9289, lng: 116.4164, services: [['户外陪同', 120, '小时', 3], ['钓鱼陪伴', 200, '次', 1]] },
  { name: '阿茶', gender: 'female', city: '杭州', district: '西湖区', age: 22, height: 165, weight: 46, constellation: '双鱼座', education: '本科', tags: ['茶文化', '西湖漫步', '汉服陪拍', '化妆'], bio: '茶艺师，可陪你体验龙井茶村，汉服妆造+陪拍一条龙。', lat: 30.2441, lng: 120.1357, services: [['西湖陪同', 108, '小时', 2], ['汉服妆造陪拍', 399, '次', 1], ['茶文化体验', 188, '次', 1]] },
  { name: '小川', gender: 'male', city: '杭州', district: '滨江区', age: 25, height: 180, weight: 68, constellation: '射手座', education: '本科', tags: ['游戏陪玩', '电竞', '骑行', '数码'], bio: '大厂程序员，游戏段位王者，也可陪你环西湖骑行。', lat: 30.2084, lng: 120.2121, services: [['游戏陪玩', 60, '小时', 2], ['骑行陪同', 90, '小时', 2]] },
  { name: '唐糖', gender: 'female', city: '成都', district: '锦江区', age: 24, height: 162, weight: 47, constellation: '白羊座', education: '大专', tags: ['火锅探店', '麻将搭子', '熊猫基地', '夜市'], bio: '成都土著吃货，带你吃遍本地人排队的老馆子，麻将三缺一随时叫我。', lat: 30.6523, lng: 104.0809, services: [['美食陪同', 99, '小时', 2], ['麻将搭子', 80, '小时', 3], ['全天陪同', 599, '天', 1]] },
  { name: '老白', gender: 'male', city: '成都', district: '武侯区', age: 30, height: 175, weight: 75, constellation: '金牛座', education: '本科', tags: ['徒步领队', '川西攻略', '摄影', '自驾'], bio: '户外领队出身，川西小环线老司机，可定制徒步摄影行程。', lat: 30.6417, lng: 104.0433, services: [['徒步陪同', 150, '小时', 4], ['行程定制', 299, '次', 1]] },
];

const DYNAMICS = [
  { idx: 0, content: '今天带客人走了武康路→安福路线，梧桐区的秋天真的太适合拍照了，出片率100%📷', city: '上海' },
  { idx: 4, content: '龙井村采茶季快结束了，这周去了三天，客人自己做的茶叶可以带走哦', city: '杭州' },
  { idx: 2, content: '国博「古代中国」常设展真的百看不厌，今天讲了四个小时嗓子都哑了但超满足', city: '北京' },
  { idx: 6, content: '玉林路尽头不止有小酒馆，还有开了二十年的串串！客人说这是他来成都吃得最爽的一天', city: '成都' },
];

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
  });

  // 清库
  await prisma.$executeRawUnsafe('DELETE FROM "OrderItem"');
  await prisma.$executeRawUnsafe('DELETE FROM "Review"');
  await prisma.$executeRawUnsafe('DELETE FROM "Order"');
  await prisma.$executeRawUnsafe('DELETE FROM "DynamicLike"');
  await prisma.$executeRawUnsafe('DELETE FROM "DynamicComment"');
  await prisma.$executeRawUnsafe('DELETE FROM "Dynamic"');
  await prisma.$executeRawUnsafe('DELETE FROM "Follow"');
  await prisma.$executeRawUnsafe('DELETE FROM "PartnerService"');
  await prisma.$executeRawUnsafe('DELETE FROM "Partner"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
  await prisma.$executeRawUnsafe('DELETE FROM "Banner"');

  for (let i = 0; i < PARTNERS.length; i++) {
    const p = PARTNERS[i];
    const avatar = save(`avatar-${i}.svg`, svgAvatar(p.name, i));
    const photos = [0, 1, 2].map((k) => save(`photo-${i}-${k}.svg`, svgPhoto(`${p.city} · ${p.tags[0]}`, i, k)));
    const user = await prisma.user.create({
      data: {
        mobile: `1380000${String(1000 + i).slice(1)}`,
        nickname: p.name,
        avatar,
        gender: p.gender,
        city: p.city,
      },
    });
    await prisma.partner.create({
      data: {
        userId: user.id,
        photos: JSON.stringify(photos),
        bio: p.bio,
        age: p.age,
        height: p.height,
        weight: p.weight,
        constellation: p.constellation,
        education: p.education,
        tags: JSON.stringify(p.tags),
        city: p.city,
        district: p.district,
        latitude: p.lat,
        longitude: p.lng,
        status: 'available',
        auditStatus: 'approved',
        verified: true,
        serviceCount: 20 + Math.floor(Math.random() * 180),
        viewCount: 100 + Math.floor(Math.random() * 2000),
        rating: Math.round((4.5 + Math.random() * 0.5) * 10) / 10,
        wechatId: `wx_${p.city}_${100 + i}`,
        services: {
          create: (p.services as Array<[string, number, string, number]>).map(([name, price, unit, miniNum], k) => ({
            name, price, unit, miniNum, sort: k,
          })),
        },
      },
    });
  }

  await prisma.user.create({
    data: { mobile: '13800138000', nickname: '平台管理员', role: 'admin' },
  });

  await prisma.coupon.createMany({
    data: [
      { title: '新人立减券', amount: 20, minSpend: 100, expiresAt: new Date(Date.now() + 30 * 86400e3) },
      { title: '无门槛体验券', amount: 5, minSpend: 0, expiresAt: new Date(Date.now() + 30 * 86400e3) },
    ],
  });

  const dynamicUsers = await prisma.user.findMany({ include: { partner: true } });
  for (const d of DYNAMICS) {
    const u = dynamicUsers[d.idx];
    await prisma.dynamic.create({
      data: {
        userId: u.id,
        content: d.content,
        images: JSON.stringify([save(`dyn-${d.idx}.svg`, svgPhoto('动态', d.idx, 1))]),
        city: d.city,
        likeCount: Math.floor(Math.random() * 50),
        commentCount: Math.floor(Math.random() * 10),
      },
    });
  }

  await prisma.banner.createMany({
    data: [
      { image: save('banner-0.svg', svgBanner('城市玩伴', '找个本地人带你玩 · 平台担保更安心', 0)), sort: 0 },
      { image: save('banner-1.svg', svgBanner('新人立减', '首单立减30元 · 券后更划算', 4)), sort: 1 },
    ],
  });

  console.log('seed done');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
