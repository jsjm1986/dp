<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { showConfirmDialog, showImagePreview, showToast } from 'vant';
import { api } from '../api';

type Dash = Awaited<ReturnType<typeof api.adminDashboard>>;
type PartnerRow = Awaited<ReturnType<typeof api.adminPartners>>['items'][number];
type OrderRow = Awaited<ReturnType<typeof api.adminOrders>>['items'][number];
type DynRow = Awaited<ReturnType<typeof api.adminDynamics>>['items'][number];
type UserRow = Awaited<ReturnType<typeof api.adminUsers>>['items'][number];
type BannerRow = { id: string; image: string; link: string | null; sort: number };
type WithdrawalRow = Awaited<ReturnType<typeof api.adminWithdrawals>>[number];
type Settings = Awaited<ReturnType<typeof api.adminSettings>>;
type CommissionRow = Awaited<ReturnType<typeof api.adminCommissions>>['items'][number];
type CouponRow = Awaited<ReturnType<typeof api.adminCoupons>>[number];

const tab = ref('dash');
const dash = ref<Dash | null>(null);
const partners = ref<PartnerRow[]>([]);
const partnerTab = ref<'pending' | 'approved' | 'rejected' | 'all'>('pending');
const orders = ref<OrderRow[]>([]);
const orderStatus = ref('');
const dynamics = ref<DynRow[]>([]);
const users = ref<UserRow[]>([]);
const banners = ref<BannerRow[]>([]);
const withdrawals = ref<WithdrawalRow[]>([]);
const settings = ref<Settings | null>(null);
const rateInput = ref(5);
const wordsInput = ref('');
const commissions = ref<CommissionRow[]>([]);
const coupons = ref<CouponRow[]>([]);
const couponEdit = ref({ show: false, title: '', amount: 5, minSpend: 0, total: -1, days: 30 });
const saving = ref(false);
const bannerEdit = ref<{ show: boolean; id?: string; image: string; link: string; sort: number }>({
  show: false, image: '', link: '', sort: 0,
});
const uploading = ref(false);

const statusMap: Record<string, string> = {
  pending_payment: '待支付', pending_accept: '待接单', pending_service: '待服务',
  serving: '服务中', done: '已完成', cancelled: '已取消', rejected: '已拒绝', refunding: '退款中', refunded: '已退款',
};
const orderStatusOptions = [
  { text: '全部状态', value: '' },
  ...Object.entries(statusMap).map(([value, text]) => ({ text, value })),
];
const auditMap: Record<string, { text: string; color: string }> = {
  pending: { text: '待审核', color: '#ff9f00' },
  approved: { text: '已通过', color: '#07c160' },
  rejected: { text: '已拒绝', color: '#ee0a24' },
};

async function loadDash() { dash.value = await api.adminDashboard(); }
async function loadPartners() { partners.value = (await api.adminPartners(partnerTab.value)).items; }
async function loadOrders() { orders.value = (await api.adminOrders(1, orderStatus.value || undefined)).items; }
async function loadDynamics() { dynamics.value = (await api.adminDynamics()).items; }
async function loadUsers() { users.value = (await api.adminUsers()).items; }
async function loadBanners() { banners.value = await api.adminBanners(); }
async function loadWithdrawals() { withdrawals.value = await api.adminWithdrawals('all'); }

async function loadSettings() {
  settings.value = await api.adminSettings();
  rateInput.value = settings.value.commissionRate;
  wordsInput.value = settings.value.sensitiveWords.join('，');
  commissions.value = (await api.adminCommissions()).items;
}

async function saveSettings() {
  saving.value = true;
  try {
    await api.adminUpdateSettings({ commissionRate: rateInput.value });
    showToast('已保存');
    loadSettings();
  } finally {
    saving.value = false;
  }
}

async function saveWords() {
  saving.value = true;
  try {
    const words = wordsInput.value.split(/[,，\n]+/).map((w) => w.trim()).filter(Boolean);
    await api.adminUpdateSettings({ sensitiveWords: words });
    showToast('敏感词已更新');
  } finally {
    saving.value = false;
  }
}

async function loadCoupons() { coupons.value = await api.adminCoupons(); }

async function createCoupon() {
  if (!couponEdit.value.title.trim()) return showToast('请输入券名称');
  await api.adminCreateCoupon({
    title: couponEdit.value.title.trim(),
    amount: couponEdit.value.amount,
    minSpend: couponEdit.value.minSpend,
    total: couponEdit.value.total,
    days: couponEdit.value.days,
  });
  couponEdit.value.show = false;
  couponEdit.value.title = '';
  showToast('已创建');
  loadCoupons();
}

async function removeCoupon(id: string) {
  try {
    await showConfirmDialog({ title: '删除优惠券', message: '已领取的券不受影响，确定删除模板？' });
  } catch { return; }
  await api.adminDeleteCoupon(id);
  coupons.value = coupons.value.filter((c) => c.id !== id);
}

async function toggleUser(u: UserRow) {
  const action = u.disabled ? '启用' : '禁用';
  try {
    await showConfirmDialog({ title: `${action}用户`, message: `确定${action}「${u.nickname}」吗？禁用后无法登录。` });
  } catch { return; }
  await api.adminToggleUser(u.id, !u.disabled);
  u.disabled = !u.disabled;
  showToast(`已${action}`);
}

async function handleWithdrawal(w: WithdrawalRow, ok: boolean) {
  if (!ok) {
    try {
      await showConfirmDialog({ title: '拒绝提现', message: `拒绝后 ¥${w.amount} 将退回玩伴余额，确认？` });
    } catch { return; }
  }
  await (ok ? api.adminApproveWithdrawal(w.id) : api.adminRejectWithdrawal(w.id, '不符合提现条件'));
  showToast(ok ? '已打款' : '已拒绝并退款');
  loadWithdrawals();
}

async function audit(id: string, ok: boolean) {
  await (ok ? api.adminApprove(id) : api.adminReject(id));
  showToast(ok ? '已通过' : '已拒绝');
  loadPartners(); loadDash();
}

async function toggleVerify(p: PartnerRow) {
  await api.adminVerify(p.id, !p.verified);
  p.verified = !p.verified;
}

async function removeDynamic(id: string) {
  try {
    await showConfirmDialog({ title: '删除动态', message: '确定删除这条动态吗？' });
  } catch { return; }
  await api.adminDeleteDynamic(id);
  dynamics.value = dynamics.value.filter((d) => d.id !== id);
  showToast('已删除');
}

function openBanner(b?: BannerRow) {
  bannerEdit.value = b
    ? { show: true, id: b.id, image: b.image, link: b.link ?? '', sort: b.sort }
    : { show: true, image: '', link: '', sort: 0 };
}

async function saveBanner() {
  if (!bannerEdit.value.image) return showToast('请上传图片');
  await api.adminSaveBanner({ id: bannerEdit.value.id, image: bannerEdit.value.image, link: bannerEdit.value.link || undefined, sort: bannerEdit.value.sort });
  bannerEdit.value.show = false;
  loadBanners();
}

async function uploadBanner(file: File) {
  uploading.value = true;
  try {
    const res = await api.upload(file);
    bannerEdit.value.image = res.url;
  } finally { uploading.value = false; }
}

async function removeBanner(id: string) {
  try {
    await showConfirmDialog({ title: '删除 Banner', message: '确定删除吗？' });
  } catch { return; }
  await api.adminDeleteBanner(id);
  banners.value = banners.value.filter((b) => b.id !== id);
}

function fmt(t: string) {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onMounted(() => { loadDash(); loadPartners(); });

function onTabChange(name: string | number) {
  if (name === 'partners') loadPartners();
  if (name === 'orders') loadOrders();
  if (name === 'dynamics') loadDynamics();
  if (name === 'users') loadUsers();
  if (name === 'banners') loadBanners();
  if (name === 'withdrawals') loadWithdrawals();
  if (name === 'coupons') loadCoupons();
  if (name === 'settings') loadSettings();
}
</script>

<template>
  <div class="page admin">
    <van-nav-bar title="管理后台" left-arrow @click-left="$router.back()" />

    <van-tabs v-model:active="tab" sticky @change="onTabChange">
      <!-- 数据 -->
      <van-tab title="数据" name="dash">
        <div v-if="dash" class="admin__dash">
          <div class="admin__stat"><b>{{ dash.userCount }}</b><span>用户</span></div>
          <div class="admin__stat"><b>{{ dash.partnerApproved }}</b><span>在营玩伴</span></div>
          <div class="admin__stat"><b class="warn">{{ dash.partnerPending }}</b><span>待审核</span></div>
          <div class="admin__stat"><b>{{ dash.orderCount }}</b><span>总订单</span></div>
          <div class="admin__stat"><b>{{ dash.todayOrders }}</b><span>今日订单</span></div>
          <div class="admin__stat"><b class="warn">{{ dash.pendingAccept }}</b><span>待接单</span></div>
          <div class="admin__stat"><b>{{ dash.serving }}</b><span>服务中</span></div>
          <div class="admin__stat"><b>¥{{ dash.gmv.toFixed(0) }}</b><span>交易额</span></div>
          <div class="admin__stat"><b>{{ dash.dynamicCount }}</b><span>动态</span></div>
          <div class="admin__stat"><b>{{ dash.messageCount }}</b><span>私信</span></div>
        </div>
      </van-tab>

      <!-- 玩伴审核 -->
      <van-tab title="玩伴" name="partners">
        <van-tabs v-model:active="partnerTab" type="card" @change="loadPartners">
          <van-tab title="待审核" name="pending" />
          <van-tab title="已通过" name="approved" />
          <van-tab title="已拒绝" name="rejected" />
          <van-tab title="全部" name="all" />
        </van-tabs>
        <div class="admin__list">
          <div v-for="p in partners" :key="p.id" class="card admin__partner">
            <div class="admin__partner-head">
              <van-image round width="44" height="44" :src="p.avatar || ''" />
              <div class="admin__partner-info">
                <div><b>{{ p.nickname }}</b> <van-tag :color="auditMap[p.auditStatus]?.color" plain>{{ auditMap[p.auditStatus]?.text }}</van-tag></div>
                <div class="muted">{{ p.mobile }} · {{ p.city }}{{ p.district ? '·' + p.district : '' }}</div>
              </div>
              <van-tag v-if="p.verified" type="primary" plain>已实名</van-tag>
            </div>
            <div v-if="p.bio" class="admin__partner-bio">{{ p.bio }}</div>
            <div class="admin__partner-tags">
              <van-tag v-for="t in p.tags" :key="t" plain type="primary">{{ t }}</van-tag>
            </div>
            <div v-if="p.photos.length" class="admin__partner-photos">
              <van-image
                v-for="(img, i) in p.photos.slice(0, 4)" :key="i"
                width="60" height="60" radius="6" fit="cover" :src="img"
                @click="showImagePreview({ images: p.photos, startPosition: i })"
              />
            </div>
            <div class="admin__partner-svc">
              <span v-for="s in p.services" :key="s.name">{{ s.name }} ¥{{ s.price }}/{{ s.unit }}</span>
            </div>
            <div class="admin__partner-ops">
              <template v-if="p.auditStatus === 'pending'">
                <van-button size="small" type="success" round @click="audit(p.id, true)">通过</van-button>
                <van-button size="small" type="danger" round plain @click="audit(p.id, false)">拒绝</van-button>
              </template>
              <van-button v-if="p.auditStatus === 'approved'" size="small" round plain @click="toggleVerify(p)">
                {{ p.verified ? '取消实名标' : '加实名标' }}
              </van-button>
            </div>
          </div>
          <van-empty v-if="!partners.length" description="暂无记录" image-size="70" />
        </div>
      </van-tab>

      <!-- 订单 -->
      <van-tab title="订单" name="orders">
        <van-dropdown-menu active-color="#ff5a5f">
          <van-dropdown-item v-model="orderStatus" :options="orderStatusOptions" @change="loadOrders" />
        </van-dropdown-menu>
        <div class="admin__list">
          <van-cell v-for="o in orders" :key="o.id" :title="`${o.customer} → ${o.partner}`" :label="`${o.orderNo} · ${fmt(o.createdAt)}`">
            <template #value>
              <div class="admin__order-val">
                <div>¥{{ o.totalAmount }}</div>
                <van-tag>{{ statusMap[o.status] || o.status }}</van-tag>
              </div>
            </template>
          </van-cell>
          <van-empty v-if="!orders.length" description="暂无订单" image-size="70" />
        </div>
      </van-tab>

      <!-- 用户 -->
      <van-tab title="用户" name="users">
        <div class="admin__list">
          <van-cell v-for="u in users" :key="u.id" :title="u.nickname" :label="`${u.mobile} · ${u.orderCount}单 · ${fmt(u.createdAt)}`">
            <template #icon>
              <van-image round width="36" height="36" :src="u.avatar || ''" class="admin__user-avatar" />
            </template>
            <template #value>
              <div class="admin__user-ops">
                <van-tag v-if="u.disabled" type="danger">已禁用</van-tag>
                <van-tag v-else-if="u.role === 'admin'" type="primary">管理员</van-tag>
                <van-tag v-else-if="u.partnerId" type="success" plain>玩伴</van-tag>
                <span v-else class="muted">用户</span>
                <van-button
                  v-if="u.role !== 'admin'" size="mini" round plain
                  :type="u.disabled ? 'success' : 'danger'"
                  @click="toggleUser(u)"
                >
                  {{ u.disabled ? '启用' : '禁用' }}
                </van-button>
              </div>
            </template>
          </van-cell>
        </div>
      </van-tab>

      <!-- 动态 -->
      <van-tab title="动态" name="dynamics">
        <div class="admin__list">
          <div v-for="d in dynamics" :key="d.id" class="card admin__dyn">
            <div class="admin__dyn-head">
              <van-image round width="32" height="32" :src="d.avatar || ''" />
              <span>{{ d.author }}</span>
              <span class="muted">{{ d.city }}</span>
              <van-button size="mini" type="danger" plain class="admin__dyn-del" @click="removeDynamic(d.id)">删除</van-button>
            </div>
            <div class="admin__dyn-content">{{ d.content }}</div>
            <div class="muted">❤ {{ d.likeCount }} · 💬 {{ d.commentCount }} · {{ fmt(d.createdAt) }}</div>
          </div>
          <van-empty v-if="!dynamics.length" description="暂无动态" image-size="70" />
        </div>
      </van-tab>

      <!-- 提现 -->
      <van-tab title="提现" name="withdrawals">
        <div class="admin__list">
          <div v-for="w in withdrawals" :key="w.id" class="card admin__wd">
            <div class="admin__wd-head">
              <van-image round width="36" height="36" :src="w.partner.avatar || ''" />
              <div class="admin__wd-info">
                <div><b>{{ w.partner.nickname }}</b> <span class="muted">{{ w.partner.mobile }}</span></div>
                <div class="muted">{{ fmt(w.createdAt) }}</div>
              </div>
              <div class="admin__wd-amount">¥{{ w.amount.toFixed(2) }}</div>
            </div>
            <div class="admin__wd-ops">
              <van-tag :type="w.status === 'done' ? 'success' : w.status === 'rejected' ? 'danger' : 'warning'">
                {{ w.status === 'done' ? '已打款' : w.status === 'rejected' ? '已拒绝' : '待审核' }}
              </van-tag>
              <template v-if="w.status === 'pending'">
                <van-button size="small" type="success" round @click="handleWithdrawal(w, true)">打款</van-button>
                <van-button size="small" type="danger" round plain @click="handleWithdrawal(w, false)">拒绝</van-button>
              </template>
            </div>
          </div>
          <van-empty v-if="!withdrawals.length" description="暂无提现申请" image-size="70" />
        </div>
      </van-tab>

      <!-- Banner -->
      <van-tab title="Banner" name="banners">
        <div class="admin__list">
          <div v-for="b in banners" :key="b.id" class="card admin__banner">
            <van-image height="70" fit="cover" radius="8" :src="b.image" @click="showImagePreview({ images: [b.image] })" />
            <div class="admin__banner-ops">
              <span class="muted">排序 {{ b.sort }} {{ b.link ? '· ' + b.link : '' }}</span>
              <div>
                <van-button size="mini" plain @click="openBanner(b)">编辑</van-button>
                <van-button size="mini" type="danger" plain @click="removeBanner(b.id)">删除</van-button>
              </div>
            </div>
          </div>
          <van-button block round type="primary" plain class="admin__banner-add" @click="openBanner()">新增 Banner</van-button>
        </div>
      </van-tab>

      <!-- 优惠券 -->
      <van-tab title="优惠券" name="coupons">
        <div class="admin__list">
          <div v-for="c in coupons" :key="c.id" class="card admin__coupon">
            <div class="admin__coupon-amount">¥{{ c.amount }}</div>
            <div class="admin__coupon-info">
              <div><b>{{ c.title }}</b></div>
              <div class="muted">
                {{ c.minSpend > 0 ? `满${c.minSpend}可用` : '无门槛' }} ·
                {{ c.total < 0 ? '不限量' : `限${c.total}张` }} · 已领{{ c.claimed }} ·
                {{ fmt(c.expiresAt) }}到期
              </div>
            </div>
            <van-button size="mini" type="danger" plain @click="removeCoupon(c.id)">删除</van-button>
          </div>
          <van-empty v-if="!coupons.length" description="暂无券模板" image-size="70" />
          <van-button block round type="primary" plain class="admin__banner-add" @click="couponEdit.show = true">新增优惠券</van-button>
        </div>
      </van-tab>

      <!-- 设置 -->
      <van-tab title="设置" name="settings">
        <div v-if="settings" class="admin__list">
          <div class="card admin__set">
            <div class="admin__set-title">分销佣金比例</div>
            <div class="muted">下线用户完成订单后，推荐人获得订单金额一定比例的佣金（0-50%）</div>
            <div class="admin__set-row">
              <van-stepper v-model="rateInput" min="0" max="50" step="1" theme="round" button-size="24" />
              <span class="admin__set-unit">%</span>
              <van-button size="small" type="primary" round :loading="saving" @click="saveSettings">保存</van-button>
            </div>
            <div class="muted admin__set-stat">
              累计发放佣金 ¥{{ settings.commissionTotal.toFixed(2) }} · {{ settings.commissionCount }}笔
            </div>
          </div>

          <div class="card admin__set">
            <div class="admin__set-title">敏感词库</div>
            <div class="muted">用于动态、评论、私信的违规内容拦截，逗号或换行分隔；清空则恢复默认词库</div>
            <van-field
              v-model="wordsInput" type="textarea" rows="4" autosize
              placeholder="敏感词，用逗号分隔"
              class="admin__set-words"
            />
            <van-button size="small" type="primary" round :loading="saving" @click="saveWords">保存词库</van-button>
          </div>

          <div class="card admin__set">
            <div class="admin__set-title">佣金明细</div>
            <div v-for="c in commissions" :key="c.id" class="admin__commission">
              <div>
                <b>{{ c.inviter }}</b><span class="muted">（{{ c.inviterMobile }}）</span>
                ← {{ c.invitee }}
              </div>
              <div class="muted">订单 {{ c.orderNo }} · 比例 {{ (c.rate * 100).toFixed(0) }}% · {{ fmt(c.createdAt) }}</div>
              <div class="admin__commission-amount">+¥{{ c.amount.toFixed(2) }}</div>
            </div>
            <van-empty v-if="!commissions.length" description="暂无佣金记录" image-size="70" />
          </div>
        </div>
      </van-tab>
    </van-tabs>

    <van-dialog v-model:show="bannerEdit.show" title="Banner" show-cancel-button @confirm="saveBanner">
      <div class="admin__banner-form">
        <van-uploader :after-read="(f: any) => uploadBanner(f.file)" :disabled="uploading">
          <van-image v-if="bannerEdit.image" height="80" fit="cover" :src="bannerEdit.image" />
          <div v-else class="admin__banner-upload">点击上传图片</div>
        </van-uploader>
        <van-field v-model="bannerEdit.link" placeholder="跳转链接（可选）" />
        <van-field v-model.number="bannerEdit.sort" type="number" placeholder="排序（越小越前）" />
      </div>
    </van-dialog>

    <van-dialog v-model:show="couponEdit.show" title="新增优惠券" show-cancel-button @confirm="createCoupon">
      <div class="admin__banner-form">
        <van-field v-model="couponEdit.title" placeholder="券名称，如：新人立减券" />
        <van-field v-model.number="couponEdit.amount" type="number" placeholder="面额（元）" />
        <van-field v-model.number="couponEdit.minSpend" type="number" placeholder="最低消费门槛，0为无门槛" />
        <van-field v-model.number="couponEdit.total" type="number" placeholder="限量张数，-1为不限量" />
        <van-field v-model.number="couponEdit.days" type="number" placeholder="有效天数" />
      </div>
    </van-dialog>
  </div>
</template>

<style scoped>
.admin__dash {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 12px;
}
.admin__stat {
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  text-align: center;
}
.admin__stat b {
  display: block;
  font-size: 20px;
}
.admin__stat b.warn { color: #ee0a24; }
.admin__stat span { color: #999; font-size: 12px; }
.admin__list { padding: 12px; }
.admin__partner { padding: 12px; margin-bottom: 10px; }
.admin__partner-head { display: flex; align-items: center; gap: 10px; }
.admin__partner-info { flex: 1; }
.admin__partner-bio { font-size: 13px; color: #555; margin: 8px 0; }
.admin__partner-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.admin__partner-photos { display: flex; gap: 6px; margin-bottom: 8px; }
.admin__partner-svc { font-size: 12px; color: #888; display: flex; gap: 10px; flex-wrap: wrap; }
.admin__partner-ops { margin-top: 10px; display: flex; gap: 10px; }
.admin__order-val { text-align: right; }
.admin__user-avatar { margin-right: 10px; }
.admin__dyn { padding: 12px; margin-bottom: 10px; }
.admin__dyn-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.admin__dyn-del { margin-left: auto; }
.admin__dyn-content { font-size: 14px; margin-bottom: 6px; }
.admin__banner { padding: 10px; margin-bottom: 10px; }
.admin__banner-ops { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.admin__banner-add { margin-top: 8px; }
.admin__banner-form { padding: 16px; }
.admin__banner-upload {
  width: 100%; height: 80px; background: #f5f6f8; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; color: #999;
}
.admin__wd { padding: 12px; margin-bottom: 10px; }
.admin__wd-head { display: flex; align-items: center; gap: 10px; }
.admin__wd-info { flex: 1; }
.admin__wd-amount { font-size: 18px; font-weight: 800; color: #ff5a5f; }
.admin__wd-ops { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.admin__user-ops { display: flex; align-items: center; gap: 8px; }
.admin__coupon { display: flex; align-items: center; gap: 12px; padding: 12px; margin-bottom: 10px; }
.admin__coupon-amount { color: #ff5a5f; font-size: 24px; font-weight: 800; }
.admin__coupon-info { flex: 1; font-size: 12px; }
.admin__set { padding: 14px; margin-bottom: 12px; }
.admin__set-title { font-weight: 700; margin-bottom: 4px; }
.admin__set-row { display: flex; align-items: center; gap: 10px; margin: 12px 0 6px; }
.admin__set-unit { font-size: 16px; font-weight: 700; }
.admin__set-stat { font-size: 12px; }
.admin__set-words { background: #f7f8fa; border-radius: 8px; margin: 10px 0; }
.admin__commission { position: relative; padding: 10px 0; border-bottom: 1px solid #f5f5f5; font-size: 13px; }
.admin__commission:last-of-type { border-bottom: 0; }
.admin__commission-amount { position: absolute; right: 0; top: 10px; color: #ff5a5f; font-weight: 800; }
</style>