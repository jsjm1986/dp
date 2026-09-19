# 城市玩伴（dp）全仓库代码质量审查报告

- 审查日期：2026-09-19
- 审查方式：全量逐文件人工阅读 + 机械扫描交叉验证 + 实际运行验证（lint / 单测 / e2e / 构建 / 93 项冒烟）
- 审查基线：`main @ 5ff5fda`

---

## 0. 阅读覆盖率（100% 通读声明）

本报告基于对下列**全部**源码文件的逐行阅读，非抽样：

| 范围 | 文件数 | 说明 |
|---|---|---|
| `server/src` 业务代码（非生成） | 33 个 `.ts` | main/app/auth/common/prisma/users/partners/orders/chat/dynamics/coupons/admin/misc，全部逐行读完 |
| `server/prisma` | 2 | schema.prisma、seed.ts 全文 |
| `server` 配置 | 11 | package.json、tsconfig×2、nest-cli、prisma.config、vitest×2、.oxlintrc、.prettierrc、.env、pnpm-workspace |
| `server/test` | 1 | app.e2e-spec.ts 全文 |
| `web/src` | 33 个 `.vue/.ts/.css` | main/App/router/stores/api/utils/2 组件/20 视图/样式，全部逐行读完 |
| `web` 配置与文档 | 8 | package.json、vite.config、tsconfig×3、index.html、README、components.d.ts |
| 脚本与部署 | 2 | scripts/smoke.py（460 行）、deploy/guide.html（246 行）全文 |
| 根目录文档 | 3 | README.md、.gitignore、.zcodeignore |
| `server/src/generated/prisma`（Prisma 生成物，29 个文件共 ~4 万行） | 抽样 | 属机器生成代码，核对了入口（client.ts/enums.ts/models.ts）与总体结构，确认无手写痕迹后不逐行审阅 |
| `server/uploads/seed/*.svg`、`web/public/*.svg` | 抽样 | 静态占位图片资源，非代码 |

运行验证结果（审查时实测）：

| 检查 | 结果 |
|---|---|
| `pnpm lint`（server，oxlint type-aware） | 0 error，2 warning（本 PR 已修复） |
| `pnpm test` + `pnpm test:e2e`（vitest） | 通过，但仅有 2 个 Hello World 占位用例（见 §7） |
| `pnpm build`（server，nest build） | ✅ 通过 |
| `pnpm build`（web，vue-tsc + vite） | ❌ **失败**（TS6133 未使用导入 ×2，本 PR 已修复） |
| `scripts/smoke.py`（对运行中的 dev server） | ✅ 93 项全过 |

---

## 1. 总体评价

这是一个完成度相当高的演示级全栈项目（NestJS 12 + Prisma 7 + SQLite / Vue 3 + Vant 4），业务闭环完整（预约→支付→履约→评价→结算→提现→分销），整体质量**高于常见 demo 水准**。突出优点：

1. **资金操作的纪律性很好**。余额扣款/退款、卡密核销、提现、完单入账、佣金发放全部在事务内完成，且普遍使用「条件更新（`updateMany where status/balance`）+ 受影响行数检查」防并发重复操作，这是很多真实项目都做不到的（`orders.service.ts`、`users.controller.ts`、`partner-self.controller.ts`、`admin.controller.ts` 均一致）。
2. **状态机清晰**：`ORDER_STATUS` 常量 + `transition` 表驱动 + 条件更新，催单冷却、加钟子订单、级联取消/退款（`cascadeChildren`）考虑周到。
3. **安全基本功到位**：JWT 守卫覆盖审计无缺口（本次逐路由核对）；AdminGuard 双守卫；上传做了扩展名白名单 + 魔数校验并明确规避 SVG 存储型 XSS（`misc.controller.ts`）；敏感词、双向拉黑、禁用账号即时失效（守卫层每次查库）；生产门控（万能码/模拟支付/模拟充值在 `NODE_ENV=production` 下强制关闭、JWT_SECRET 强校验）。
4. **演示体验设计用心**：seed 数据真实感强、DEMO_AUTO_FLOW 自动流转、支付倒计时前后端对齐（30min）、smoke 冒烟脚本 93 项可回归。
5. 前端无 `v-html`（无 XSS 注入面）、接口层集中封装且类型完整、列表页均有分页与防抖。

**主要短板**（详见下文）：① web 生产构建当前是坏的（P0）；② 时段冲突判定存在「跨午夜 / 半日 / 次」三类低覆盖盲区；③ admin 控制器 768 行巨型文件、校验方式与分层不一致；④ 自动化测试基本缺失（仅冒烟脚本，且有一例「假绿」）；⑤ 若干进程内状态与单机 SQLite 架构决定了它只能停留在演示规模。

---

## 2. 问题清单（按严重程度分级）

> P0=必须立即修，P1=应尽快修，P2=规划内修，P3=建议/记录在案。
> 标注 ✅ 的项已随本 PR 修复；其余为建议项（附修复思路），未在本 PR 动代码以避免扩大回归面。

### P0

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| 1 | **web 生产构建失败** ✅ | `web/src/views/OrderDetail.vue:4`、`PartnerConsole.vue:4` | `showConfirmDialog` 导入未使用，`vue-tsc -b` 直接报 TS6133，`pnpm build` 退出码 2。说明最近提交未跑过前端构建，CI 缺失使该问题静默（见 §7-T4）。 |
| 2 | **管理员调余额非原子**：`updateMany` 扣/加余额与 `balanceLog.create` 分两步、无事务 | `server/src/admin/admin.controller.ts:519-526` | 两步之间进程崩溃/异常会导致「钱动了、账没记」，账本（BalanceLog）失去完整性，而全项目其它资金路径都是事务+流水成对出现。✅ 已改为与 `redeem`/`withdraw` 相同的 `$transaction` 包裹。 |

### P1

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| 3 | **seed 清库列表漏掉 `BalanceLog`** ✅ | `server/prisma/seed.ts:67-74` | 注释说「Setting 配置保留」，但 BalanceLog 同样未清。重灌演示数据后旧流水残留、指向已删除的用户，`/user/wallet`/`/partner/wallet` 在新用户身上不会出错，但管理端审计与总账会混入脏数据。 |
| 4 | **管理端仪表盘「已用券」显示的是领取数** ✅ | `web/src/views/Admin.vue:357` | 绑定 `dash.couponClaimed`（全部领取记录数）却标注「已用券」；后端专门返回了 `couponUsed`（`used=true` 计数）但前端从未使用。运营看板数据口径错误。 |
| 5 | **「半日 / 次」单位的时段占用几乎不生效** | `server/src/common/ledger.ts:37-44`（`orderHours`） | `orderHours` 只识别 `天`（全天）与 `小时`（按 num 展开）；而前端 `PartnerApply.vue:26` 允许玩伴发布 `半日`、`次` 单位服务。`半日`/`次` 的订单只占用起始 1 个小时，同玩伴其余时段照常可订 → 实际撞单。建议：未知单位按保守策略处理（视同全天占用），或定义 `半日=4h` 映射。 |
| 6 | **跨午夜预约同样低占** | `server/src/common/ledger.ts:42` | `Math.min(start + span, 24)` 把 23:00 起 3 小时的服务截断为仅占用 23 点 1 格，次日 0 点的时段不会被冲突判定拦截。当前前端可选时段为 10:00–23:00 整点，`num≤20` 时 23 点 + 长时长服务仍可触发。 |
| 7 | **smoke 用例 `referral.cycle` 「假绿」** ✅ | `scripts/smoke.py:365` | 请求体误用 `{"inviteCode": ...}`（正确字段为 `code`），被 DTO whitelist 校验直接 400——**成环检测分支从未被测试到**。已实测复现（响应为 `code must be a string`）。已修正字段并回归通过（此时 400 来自真正的环检测）。 |
| 8 | **「离我最近」排序只在当前分页内生效** | `server/src/partners/partners.service.ts:72-75` | 先按 recommended/rating 分页取数、再在内存里对**本页**按距离排序。第 2 页可能存在比第 1 页更近的玩伴，排序结果全局不正确。修法：distance 排序时改用 SQL 距离表达式（或粗筛经纬度包围盒后取多页排序）。 |

### P2

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| 9 | **admin 巨型控制器（768 行）+ 分层不一致** | `server/src/admin/admin.controller.ts` | 订单/玩伴模块有 service 层，admin 把全部业务写在控制器里；且 `forceCancelOrder` 把 `OrdersService.cancel + cascadeChildren` 的逻辑**复制了一份**（含退款/退券/级联子单约 40 行）——两处逻辑将来必然漂移（事实上 forceCancel 比 user cancel 多支持 `serving` 状态退款）。建议：抽 `AdminService`，级联逻辑下沉为共享私有方法/领域服务。 |
| 10 | **入参校验风格不统一** | `admin.controller.ts` 多处 | 一半端点用 class-validator DTO（`BannerDto`/`CouponDto`），另一半用裸 `@Body() body: { disabled: boolean }` 手工判空（verify/recommend/status/role/disabled/balance/recharge-cards/withdrawal reject/order cancel）。TS 类型运行时即擦除，`body.remark` 传对象、`body.reason` 传超长字符串都不会被拦截（admin.forceCancel 的 reason 就没有长度上限）。建议统一为 DTO。 |
| 11 | **玩伴资料整体替换 + 服务 ID 抖动** | `partner-self.controller.ts:228-254` | 每次改资料都 `deleteMany` 全部服务重建（且回到待审核）。历史订单靠 `OrderItem` 快照不受影响（设计正确），但 `OrderItem.serviceId` 因 `SetNull` 全部置空，「再来一单」只能靠 items 快照。可接受，但建议文档化该取舍。 |
| 12 | **并发重复入驻会 500** | `partner-self.controller.ts:159-189` | `findUnique` 检查与 `partner.create` 非事务，双击/双端同时提交会撞 `userId @unique` 抛 P2002 → 未捕获 → 500。建议捕获 P2002 转友好 400。 |
| 13 | **时区口径混用** | `partner-self.controller.ts:269-270`、`admin.controller.ts:75-76` | 统计「今日」用 `setHours(0,0,0,0)`（服务器本地时区），而预约时段已统一北京时间口径（`bjDayStart`，`ledger.ts`）。服务器时区非 CST 时「今日订单」边界与业务日不一致。建议复用 `bjDayStart`。 |
| 14 | **玩伴端订单列表无分页** | `orders.service.ts:396-406`（`take: 50`） | 超过 50 条后旧订单在玩伴工作台不可达。用户端/管理端均有分页，唯此处缺失。 |
| 15 | **会话列表取 1000 条内存分组** | `chat.controller.ts:40-68` | 未读数与「最新消息」只在最近 1000 条内统计；消息量大后会漏会话。可改 SQL `groupBy(receiver/sender)` + 子查询取最新一条。演示可接受，记为扩展点。 |
| 16 | **process 内频控/演示状态不可横向扩展** | `auth.service.ts:10`、`users.controller.ts:11`、`sensitive.ts:10`、`orders.service.ts`（setTimeout 自动流转） | 登录/核销频控 Map、敏感词缓存、演示自动流转定时器均为进程内存，多实例部署即失效。演示无碍，README「待做」宜补充这一架构边界。 |
| 17 | **CORS 全开 + 无安全响应头** | `main.ts:14` | `enableCors()` 默认 `*`；无 helmet（无 `X-Content-Type-Options`/`CSP` 等）。上传目录 `/uploads` 同源静态服务，虽已挡 SVG，仍建议补 helmet + 限定 CORS 来源。 |
| 18 | **短信接口缺每手机号日级上限** | `auth.service.ts:19-36` | 只有 60s 复用窗口，1 分钟 1 条可打满一天。演示无碍，接真实短信通道前必须补日级/小时级配额。 |
| 19 | **Money 用 float 承载** | 全局（`Number(balance)`、`round2`） | Decimal 入库、JS number 计算/出参。演示规模无误差问题，但生产化建议全链路整数分。 |
| 20 | **`expireStalePayments` 只挂在用户端查询上** | `orders.service.ts:175-193` | 超时未支付订单仅在用户查列表/详情时懒过期；管理端与玩伴端可能长期看到过期待支付单（对端不可支付，但展示误导）。建议管理端列表同样触发或加定时兜底。 |

### P3（建议 / 记录）

- `partners.service.ts:54-59`：排序三分支中 `rating` 与 `default` 完全相同（死分支）；`newest` 仍以 recommended 优先，与文案「最近新人」语义不符。建议明确产品语义后收敛为一个 orderBy。
- `web/src/stores/user.ts:10`：`JSON.parse(localStorage...)` 无 try/catch，脏数据会白屏。
- `web/src/views/Partners.vue:53-56`：选「离我最近」时 `pickSort` 与 `locate()` 回调各触发一次 `load(true)`，重复请求竞态。
- `Mine.vue` 与 `Wallet.vue` 各实现了一遍「充值+卡密兑换」UI 与逻辑；`Admin.vue` 的 `statusMap` 与 `utils/order.ts` 的 `ORDER_STATUS_TEXT` 重复。建议抽公共。
- `chat.controller.ts:38` 等：`@CurrentUser('id')` 传入的 `'id'` 参数被装饰器忽略（实际返回 `req.userId`），易误导；建议统一 `@CurrentUser()`。
- `orders.controller.ts:78`：`reject` 用 `@Body() dto?: { reason?: string }` 裸类型（同 #10）。
- 仓库卫生：`server/tsconfig.build.tsbuildinfo`（构建产物）被跟踪 ✅ 已移除并加 ignore；`server/src/generated/prisma`（29 文件 ~4 万行生成物）被跟踪——可接受（免 install 后 generate），但需在 CONTRIBUTING 说明再生成命令；`server/README.md` 仍是 NestJS 模板原文，未定制；`deploy/guide.html` 标题「城市搭子」与主名「城市玩伴」不一致。
- `web/index.html:7`：`user-scalable=no, maximum-scale=1` 禁用缩放，无障碍（WCAG 1.4.4）不友好。
- 根 README 技术栈表写「NestJS 11」✅ 已改为 12（实际依赖 ^12.0.1）；冒烟用例数已由 64 增至 93。
- `admin.controller.ts:65 userBrief`/`chat userBrief` 重复定义于两文件，可上移 common。
- `dynamic feed` 关注流未过滤 `partner.auditStatus`，玩伴被拒/回炉审核期间其动态仍在关注流可见（与公开列表策略不一致）。

---

## 3. 安全维度专项

**结论：演示语境下无高危漏洞，生产化前有一份明确的加固清单。**

已做对的（值得保持）：
- 逐路由守卫核对：全部管理端路由挂 `JwtAuthGuard, AdminGuard`；全部用户/玩伴写操作挂 `JwtAuthGuard`；公开只读端点（home/partners/dynamics feed/comments/busy）挂 `OptionalAuthGuard` 或无守卫，符合设计。**未发现越权缺口。**
- 资源归属校验完整：订单 `mustOwn`、评价 `partnerId` 归属、评论三级删除权（本人/动态作者/管理员）、会话双方校验、订单关联消息校验（`chat send` 的 orderId 必须恰为会话双方）。
- 上传安全：白名单扩展 + 魔数校验 + UUID 重命名 + 8MB 上限，明确注释了 SVG XSS 风险（`misc.controller.ts:18-25`）。
- 注入面：全项目未使用 `$queryRaw` 拼接用户输入（seed 中的 `$executeRawUnsafe` 仅拼硬编码表名）；前端无 `v-html`。
- 生产门控：`JWT_SECRET` 长度/默认值强校验（`auth.module.ts:9-11`）、万能码/模拟支付/模拟充值生产关闭。
- 前端鉴权仅是 UX（路由守卫），真正权限都在后端——边界划分正确。

生产化前必做（现未做）：
- helmet / CSP / CORS 白名单；登录与短信的 IP 级限流（现仅手机号维度、进程内存）；管理端敏感操作审计日志（角色变更、余额调整目前只有 BalanceLog，角色变更无痕）；HTTPS 反代与 `trust proxy` 配置；SQLite→MySQL/PG 迁移（README 已列入待做）。

## 4. 资金正确性专项

逐条核对过的资金路径（全部事务内、条件更新、带流水）：

| 路径 | 事务 | 防重/防超扣 | 流水 | 结论 |
|---|---|---|---|---|
| 用户支付（余额） | ✅ | `balance gte total` 条件减 + `status=pending_payment` 条件转 | `pay` 流水 | ✅ |
| 取消退款（含玩伴拒单、管理端强退、级联子单） | ✅ | `status` 条件转 + 事务内复查 | `refund` 流水 | ✅ |
| 模拟充值 / 卡密核销 | ✅ | 卡 `usedById: null` 条件占用；充值生产门控 | `recharge`/`card` | ✅（调余额见 P0-2，已修） |
| 提现申请/驳回返还 | ✅ | pending 唯一 + `balance gte` 条件减 | `withdraw`/`withdraw_refund` | ✅ |
| 完单入账 + 佣金 | ✅ | 佣金 `orderId @unique` 幂等；推荐人禁用跳过；佣金率快照 | `income`/`commission` | ✅ |
| 券：领取/占用/释放 | ✅ | `(userId,couponId)` 唯一 + `claimed>=total` 检查 + `used:false` 条件占用 | —（券无流水，可接受） | ✅ |

遗留口径问题（建议后续处理，非资金错误）：
- 模拟支付（`mock`）订单取消/拒单时状态转 `refunded` 但无流水——合理（钱未真实收付），但管理端对账时需知晓该口径。
- 平台抽成未启用（玩伴 100% 入账），`deploy/guide.html` 已如实注明。

## 5. 并发与一致性专项

- SQLite 单连接 + `busy_timeout=5000` + WAL：交互式事务在单连接上串行执行，使「事务内读-判-写」具备原子性——`orders.service.ts:125` 的注释对此有正确认知，冲突判定因此成立。
- 换单/换券/换卡/换提现四类竞态全部用条件更新兜底，即使未来迁到多连接数据库也安全（这是本仓库最值得肯定的设计）。
- 懒过期 `expireStalePayments` 用条件更新、可并发调用，幂等 ✅。
- 未覆盖的并发窗口：#12（重复入驻 500）、#8（距离排序）、#6/#5（时段低占）；`likeCount/commentCount` 采用删后重算，短暂漂移可自愈，可接受。

## 6. 可读性与可维护性

**优点**：命名统一（`mustOwn/mustBePartner/toDto/toCard`）；中文注释密度适中且解释「为什么」而非「是什么」（如 `orders.service.ts:125`、`jwt-auth.guard.ts:67`）；DTO/常量/工具各归其位；前端 BEM 风格类名统一；api 层集中、类型完整。

**欠账**（按影响排序）：
1. admin 768 行巨石控制器 + 逻辑复制（P2-9/10）——最大的维护风险点。
2. 校验/分层/DTO 位置三种风格并存（auth 有独立 dto.ts，users/orders 的 DTO 分别内联/独立，admin 一半裸类型）。
3. 魔法字符串状态遍布两栈（`'pending_payment'` 等在前后端与 admin 多处重复，前端 `utils/order.ts` 只有文案映射）。建议至少后端统一引用 `ORDER_STATUS`（已定义但 admin 未使用）。
4. `chat/dynamics/admin` 共 8 处 `where: any`（oxlint 关闭了 no-explicit-any）——可推断为赶工痕迹，`Prisma.XxxWhereInput` 可消。
5. 双端重复实现（#P3 充值 UI、状态文案、userBrief）。

## 7. 测试维度

- **单测/e2e 均为 Nest 模板占位**（Hello World），核心资金/状态机逻辑零单测覆盖。93 项 smoke 是唯一有效回归，且需手工起服务。
- smoke 质量总体很高（覆盖正向 + 越权 401/403 + 幂等 400 + 级联 + 敏感词 + 频限），但存在一例假绿（P1-7）和一例弱断言（`chat.history` 仅判断 `items` 存在，且 admin token 兜底后实际查的是空会话）。
- **无 CI**。本次实测 web build 已断而无人知晓，即直接证据。最小做法：GitHub Actions 跑 `lint + test + build`（前后端）。
- 建议补的首批单测（投入小收益大）：`orderHours`（跨午夜/半日/次）、`settleFinish` 佣金幂等、`cascadeChildren` 状态矩阵、`toUiPrice round2` 边界。

## 8. 性能与扩展

- 列表端点普遍 `count+findMany` 双查询事务、map 预取关联（无 N+1），基础扎实。
- 三个规模天花板（演示可接受、增长前必须动）：SQLite 单写者；会话 1000 条内存分组（#15）；`likeCount/commentCount` 每次全表 count。
- `expireStalePayments` 在每次用户列表/详情查询附带最多 50 次事务尝试，热点路径有放大效应（当前无碍，量大后建议改定时任务）。

## 9. 文档与仓库卫生

- 根 README 质量高（功能全景/账号/启动/待做），仅技术栈版本号漂移（已修）。
- `server/README.md` 为 NestJS 模板残留，建议替换为该服务实际说明（scripts/环境变量表）。
- 构建产物入库（tsbuildinfo，已修）；生成物入库（可接受，建议注释说明）。
- `.env` 未入库 ✅（含演示密钥，仅本地）；`dev.db` 未入库 ✅。

---

## 10. 本 PR 已修复项（10 处，全部经回归验证）

1. web 两处未使用导入 → `pnpm build` 恢复绿色（P0-1）
2. 管理员调余额入事务（P0-2）
3. seed 清库补 `BalanceLog`（P1-3）
4. 仪表盘「已用券」改绑 `couponUsed`（P1-4）
5. smoke `referral.cycle` 字段修正，成环检测真正被测到（P1-7）
6. server 两处 lint warning 清零（unused import / useless spread fallback）
7. `tsconfig.build.tsbuildinfo` 移出跟踪并加 ignore
8. README 技术栈 NestJS 11→12
9. 新增本审查报告与 `/goal` 工作区命令
10. （回归）`pnpm lint` 0 警告、server `build/test/test:e2e` 通过、web `build` 通过、smoke 93 项通过

## 11. 建议的后续路线图

1. **本周可做**：#5/#6（时段占用口径统一，先做保守策略）+ #8（距离排序）+ #14（玩伴订单分页）。
2. **下次迭代**：#9/#10（AdminService 拆分 + DTO 统一）+ 首批单测 + CI 三件套（lint/test/build）。
3. **生产化前置**：§3 加固清单 + 数据库迁移方案（Prisma migrations 替代 db push）+ 频控/敏感词/自动流转的外置化（Redis）。
