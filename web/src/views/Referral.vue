<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showToast } from 'vant';
import QRCode from 'qrcode';
import { api } from '../api';

const data = ref<Awaited<ReturnType<typeof api.referral>> | null>(null);
const bindCode = ref('');
const binding = ref(false);
const tab = ref(0);
const qrUrl = ref('');
const qrOpen = ref(false);

const inviteUrl = computed(() =>
  data.value?.inviteCode ? `${location.origin}/login?invite=${data.value.inviteCode}` : '',
);

async function load() {
  data.value = await api.referral();
  if (inviteUrl.value) {
    qrUrl.value = await QRCode.toDataURL(inviteUrl.value, {
      width: 480,
      margin: 1,
      color: { dark: '#323233', light: '#ffffff' },
    });
  }
}

async function copyCode() {
  const code = data.value?.inviteCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast('邀请码已复制');
  } catch {
    showToast(`邀请码：${code}`);
  }
}

async function copyLink() {
  if (!inviteUrl.value) return;
  try {
    await navigator.clipboard.writeText(inviteUrl.value);
    showToast('邀请链接已复制');
  } catch {
    showToast(inviteUrl.value);
  }
}

async function bind() {
  if (!bindCode.value.trim()) return showToast('请输入邀请码');
  binding.value = true;
  try {
    const r = await api.bindInviter(bindCode.value.trim());
    showToast(`已绑定推荐人：${r.inviter}`);
    bindCode.value = '';
    load();
  } finally {
    binding.value = false;
  }
}

function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onMounted(load);
</script>

<template>
  <div class="ref">
    <van-nav-bar title="推广中心" left-arrow @click-left="$router.back()" />

    <!-- 邀请码卡片 -->
    <div class="ref__hero">
      <div class="ref__hero-label">我的邀请码</div>
      <div class="ref__code" @click="copyCode">
        {{ data?.inviteCode || '…' }}
        <van-icon name="description" />
      </div>
      <div class="ref__hero-hint">好友注册时填写，或让好友在我的页面绑定</div>
      <div class="ref__rate">当前佣金比例 {{ ((data?.rate ?? 0) * 100).toFixed(0) }}%</div>
    </div>

    <!-- 二维码邀请 -->
    <div class="card ref__qr">
      <div class="ref__qr-title">扫码邀请好友</div>
      <div class="ref__qr-box" @click="qrOpen = true">
        <van-image v-if="qrUrl" :src="qrUrl" width="150" height="150" />
        <van-loading v-else size="28" />
      </div>
      <div class="muted ref__qr-hint">好友扫码进入注册页，自动绑定你为推荐人</div>
      <div class="ref__qr-actions">
        <van-button size="small" round plain type="primary" @click="qrOpen = true">查看大图</van-button>
        <van-button size="small" round plain type="primary" @click="copyLink">复制邀请链接</van-button>
      </div>
      <div class="ref__qr-link muted">{{ inviteUrl }}</div>
    </div>

    <!-- 数据卡 -->
    <div class="card ref__stats">
      <div class="ref__stat">
        <div class="ref__stat-num">{{ data?.inviteeCount ?? 0 }}</div>
        <div class="muted">已邀请用户</div>
      </div>
      <div class="ref__stat">
        <div class="ref__stat-num">¥{{ (data?.totalCommission ?? 0).toFixed(2) }}</div>
        <div class="muted">累计佣金</div>
      </div>
    </div>

    <!-- 绑定推荐人（未绑定时显示） -->
    <div v-if="data && !data.inviterNickname" class="card ref__bind">
      <div class="ref__bind-title">绑定推荐人</div>
      <div class="ref__bind-row">
        <van-field v-model="bindCode" placeholder="输入对方邀请码" maxlength="10" />
        <van-button type="primary" round :loading="binding" @click="bind">绑定</van-button>
      </div>
    </div>
    <div v-else-if="data?.inviterNickname" class="card ref__bound">
      我的推荐人：<b>{{ data.inviterNickname }}</b>
    </div>

    <!-- 明细 -->
    <van-tabs v-model:active="tab" color="#ff5a5f" sticky offset-top="46">
      <van-tab title="佣金记录">
        <div class="ref__list">
          <div v-for="c in data?.commissions ?? []" :key="c.id" class="card ref__commission">
            <div class="ref__commission-head">
              <span>{{ c.inviteeNickname }}</span>
              <span class="ref__commission-amount">+¥{{ c.amount.toFixed(2) }}</span>
            </div>
            <div class="muted">订单 {{ c.orderNo }} · 消费 ¥{{ c.orderAmount.toFixed(0) }} · 比例 {{ (c.rate * 100).toFixed(0) }}%</div>
            <div class="muted">{{ fmt(c.createdAt) }}</div>
          </div>
          <van-empty v-if="!data?.commissions.length" description="暂无佣金，快去邀请好友吧" image-size="80" />
        </div>
      </van-tab>
      <van-tab title="我的下线">
        <div class="ref__list">
          <div v-for="u in data?.invitees ?? []" :key="u.id" class="card ref__invitee">
            <van-image round width="36" height="36" :src="u.avatar || ''" />
            <div class="ref__invitee-info">
              <div>{{ u.nickname }}</div>
              <div class="muted">{{ fmt(u.createdAt) }} 加入</div>
            </div>
          </div>
          <van-empty v-if="!data?.invitees.length" description="还没有邀请用户" image-size="80" />
        </div>
      </van-tab>
    </van-tabs>

    <!-- 二维码大图弹层 -->
    <van-popup v-model:show="qrOpen" round class="ref__poster">
      <div class="ref__poster-inner">
        <div class="ref__poster-logo">城市玩伴</div>
        <div class="ref__poster-slogan">找个本地人，带你玩点不一样的</div>
        <van-image v-if="qrUrl" :src="qrUrl" width="220" height="220" />
        <div class="ref__poster-code">邀请码 {{ data?.inviteCode }}</div>
        <div class="muted">扫码注册，即成为我的好友</div>
        <van-button round block type="primary" class="ref__poster-btn" @click="copyLink">复制邀请链接</van-button>
        <div class="muted ref__poster-tip">长按图片可保存二维码</div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.ref {
  min-height: 100vh;
  background: #f7f8fa;
  padding-bottom: 20px;
}
.ref__hero {
  background: linear-gradient(135deg, #ff5a5f, #ff8a5c);
  color: #fff;
  padding: 28px 20px 32px;
  text-align: center;
}
.ref__hero-label {
  font-size: 13px;
  opacity: 0.85;
}
.ref__code {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 3px;
  margin: 8px 0 6px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.ref__hero-hint {
  font-size: 12px;
  opacity: 0.8;
}
.ref__rate {
  display: inline-block;
  margin-top: 12px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  padding: 4px 14px;
  font-size: 12px;
}
.ref__stats {
  margin: -16px 12px 0;
  display: flex;
  padding: 16px 0;
  position: relative;
}
.ref__stat {
  flex: 1;
  text-align: center;
}
.ref__stat-num {
  font-size: 20px;
  font-weight: 800;
  color: #ff5a5f;
}
.ref__bind {
  margin: 12px;
  padding: 14px;
}
.ref__bind-title {
  font-weight: 700;
  margin-bottom: 10px;
}
.ref__bind-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.ref__bound {
  margin: 12px;
  padding: 14px;
  font-size: 14px;
}
.ref__qr {
  margin: 12px;
  padding: 18px 14px;
  text-align: center;
}
.ref__qr-title {
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 12px;
}
.ref__qr-box {
  display: inline-flex;
  padding: 10px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 12px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}
.ref__qr-hint {
  margin-top: 10px;
  font-size: 12px;
}
.ref__qr-actions {
  margin-top: 12px;
  display: flex;
  justify-content: center;
  gap: 10px;
}
.ref__qr-link {
  margin-top: 10px;
  font-size: 11px;
  word-break: break-all;
}
.ref__poster {
  width: 82vw;
  max-width: 340px;
}
.ref__poster-inner {
  padding: 28px 24px 24px;
  text-align: center;
}
.ref__poster-logo {
  font-size: 22px;
  font-weight: 800;
  color: var(--dp-primary);
  letter-spacing: 2px;
}
.ref__poster-slogan {
  font-size: 12px;
  color: var(--dp-text-2);
  margin: 6px 0 18px;
}
.ref__poster-code {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  margin: 14px 0 4px;
}
.ref__poster-btn {
  margin-top: 16px;
}
.ref__poster-tip {
  margin-top: 10px;
  font-size: 11px;
}
.ref__list {
  padding: 12px;
}
.ref__commission {
  padding: 12px;
  margin-bottom: 10px;
  font-size: 12px;
}
.ref__commission-head {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}
.ref__commission-amount {
  color: #ff5a5f;
  font-weight: 800;
}
.ref__invitee {
  padding: 12px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.ref__invitee-info {
  font-size: 14px;
}
</style>
