# 城市玩伴（地陪 H5）

参考「滇域玩伴」类地陪/玩伴预约平台的自研实现。

## 技术栈

| 端 | 技术 |
|---|---|
| 前端 `web/` | Vue 3 + TypeScript + Vant 4 + Vite + Pinia + Vue Router，移动端 H5（375px 设计稿，px→vw 自适应） |
| 后端 `server/` | NestJS 11 + Prisma 7 + SQLite（better-sqlite3 驱动）+ JWT，REST API |

## 启动

```bash
# 后端
cd server
pnpm install
pnpm db:push      # 初始化 SQLite（dev.db）
pnpm db:seed      # 灌入演示数据（8 个玩伴 + 服务 + 动态 + banner + SVG 占位图）
pnpm start:dev    # http://localhost:3000

# 前端（另开终端）
cd web
pnpm install
pnpm dev          # http://localhost:5173 ，/api 和 /uploads 已代理到 3000
```

## 已实现功能

**用户端（C 端闭环）**

- 登录：手机号 + 验证码（开发环境验证码接口直接回显 `devCode`），JWT 30 天
- 首页：城市切换 / banner 轮播 / 快捷入口 / 人气推荐 / 最新入驻
- 玩伴列表：关键词搜索、排序（默认/评分最高/最近新人/离我最近）、城市筛选、下拉分页
- 玩伴详情：相册轮播、实名/平台保障/爽约包退/绿色服务标签、基本信息、服务价目、评价、关注、解锁微信号（演示免费）、立即预约
- 下单：多服务项目份数选择（含最低起购校验）、预约日期、碰面地点、备注、费用明细、平台规则协议
- 订单：状态机 `待支付→待接单→待服务→服务中→已完成 / 已取消 / 已拒绝 / 已退款`，催单（下单 5 分钟后）、取消/退款、模拟支付弹窗、评价
- 动态广场：信息流、点赞、评论、发布（图片上传到 `/uploads`）
- 我的：资料编辑、余额、我的关注、退出登录

**玩伴端接口**（已留好，无 UI）：`/api/partner/orders` + accept/reject/start/finish

## 演示模式

`DEMO_AUTO_FLOW`（默认开）：支付后订单自动流转 待接单→10s 已接单→30s 服务中→90s 已完成，配合订单详情页 5s 轮询可看到完整生命周期。关闭：`DEMO_AUTO_FLOW=false pnpm start:dev`。

## 目录

```
server/
  prisma/schema.prisma   数据模型（User/Partner/PartnerService/Order/OrderItem/Review/Dynamic/DynamicLike/DynamicComment/Follow/Banner/SmsCode）
  prisma/seed.ts         演示数据
  src/                   auth / users / partners / orders / dynamics / misc(首页+上传) / prisma
  uploads/               静态文件（seed 生成的 SVG 占位图）
web/
  src/api/               axios 封装 + 接口定义
  src/views/             12 个页面
  src/components/        PartnerCard / DynamicCard
```

## 待做（对照参考站的差距）

- 微信支付/支付宝真实接入（当前模拟）、优惠券、会员/VIP、分销邀请
- 玩伴端 H5/后台（接单、改状态、资料维护、提现）、平台管理后台
- IM 聊天、实时定位派单、团购/商家入驻
- 短信通道（当前 devCode 回显）、微信 JSSDK 登录/分享
- 合规：实名认证审核流、内容审核、导游职责边界协议文案
