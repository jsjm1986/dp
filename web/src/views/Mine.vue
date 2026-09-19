<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { api } from '../api';
import { useUserStore } from '../stores/user';

const store = useUserStore();
const router = useRouter();
const editing = ref(false);
const nickname = ref('');
const gender = ref<'male' | 'female'>('female');
const uploadingAvatar = ref(false);
const unread = ref(0);
const showRecharge = ref(false);
const rechargeAmount = ref(100);
const recharging = ref(false);
const cardCode = ref('');
const redeeming = ref(false);

async function recharge() {
  recharging.value = true;
  try {
    const res = await api.recharge(rechargeAmount.value);
    if (store.user) store.user.balance = res.balance;
    showRecharge.value = false;
    showToast('充值成功');
  } finally {
    recharging.value = false;
  }
}

async function redeem() {
  if (!cardCode.value.trim()) return showToast('请输入卡密');
  redeeming.value = true;
  try {
    const res = await api.redeemCard(cardCode.value.trim());
    if (store.user) store.user.balance = res.balance;
    cardCode.value = '';
    showRecharge.value = false;
    showToast(`充值卡到账 ¥${res.amount}`);
  } finally {
    redeeming.value = false;
  }
}

async function uploadAvatar(file: File) {
  uploadingAvatar.value = true;
  try {
    const res = await api.upload(file);
    store.user = await api.updateProfile({ avatar: res.url });
  } finally {
    uploadingAvatar.value = false;
  }
}

onMounted(() => {
  store.refresh().catch(() => {});
  api.unreadCount().then((r) => (unread.value = r.count)).catch(() => {});
});

function openEdit() {
  nickname.value = store.user?.nickname ?? '';
  gender.value = (store.user?.gender as 'male' | 'female') || 'female';
  editing.value = true;
}

async function saveName() {
  if (!nickname.value.trim()) return;
  store.user = await api.updateProfile({ nickname: nickname.value.trim(), gender: gender.value });
  editing.value = false;
}

async function contactService() {
  const svc = await api.service();
  if (!svc) return showToast('暂无客服在线');
  router.push(`/chat/${svc.id}`);
}

async function logout() {
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号吗？' });
  } catch {
    return;
  }
  store.logout();
  router.replace('/home');
}
</script>

<template>
  <div class="page mine">
    <div class="mine__hero">
      <van-uploader :after-read="(f: any) => uploadAvatar(f.file)" :disabled="uploadingAvatar">
        <div class="mine__avatar-wrap">
          <van-image round width="64" height="64" :src="store.user?.avatar || ''" class="mine__avatar" />
          <span class="mine__avatar-edit"><van-icon name="photograph" size="12" color="#fff" /></span>
        </div>
      </van-uploader>
      <div class="mine__who" @click="openEdit">
        <div class="mine__name">{{ store.user?.nickname || '未登录' }}</div>
        <div class="mine__mobile">{{ store.user?.mobile }}</div>
      </div>
      <van-icon name="edit" color="#fff" size="18" @click="openEdit" />
    </div>

    <div class="card mine__wallet">
      <div class="mine__wallet-item" @click="router.push('/wallet')">
        <div class="mine__wallet-num">¥{{ (store.user?.balance ?? 0).toFixed(2) }}</div>
        <div class="muted">余额 · 收支明细</div>
      </div>
      <div class="mine__wallet-item" @click="router.push('/follows')">
        <div class="mine__wallet-num">❤</div>
        <div class="muted">我的关注</div>
      </div>
      <div class="mine__wallet-item" @click="router.push('/orders')">
        <div class="mine__wallet-num">📋</div>
        <div class="muted">全部订单</div>
      </div>
    </div>

    <div class="card mine__menu">
      <van-cell
        v-if="store.user?.partnerId"
        title="玩伴工作台"
        is-link
        icon="shop-o"
        @click="router.push('/partner/console')"
      />
      <van-cell
        v-else
        title="申请成为玩伴"
        is-link
        icon="vip-card-o"
        @click="router.push('/partner/apply')"
      />
      <van-cell title="消息" is-link icon="chat-o" @click="router.push('/chats')">
        <template #right-icon>
          <van-badge v-if="unread" :content="unread" class="mine__unread" />
          <van-icon name="arrow" class="van-cell__right-icon" />
        </template>
      </van-cell>
      <van-cell title="我的关注" is-link icon="like-o" @click="router.push('/follows')" />
      <van-cell title="优惠券" is-link icon="coupon-o" @click="router.push('/coupons')" />
      <van-cell title="全部订单" is-link icon="orders-o" @click="router.push('/orders')" />
      <van-cell title="发动态" is-link icon="edit" @click="router.push('/dynamic/publish')" />
      <van-cell title="我的动态" is-link icon="photo-o" @click="router.push('/my-dynamics')" />
      <van-cell title="推广中心" is-link icon="share-o" @click="router.push('/referral')" />
      <van-cell v-if="store.user?.role === 'admin'" title="管理后台" is-link icon="setting-o" @click="router.push('/admin')" />
      <van-cell title="联系客服" is-link icon="service-o" @click="contactService" />
      <van-cell title="平台规则" is-link icon="description" @click="showToast('绿色服务 · 平台担保 · 爽约包退')" />
    </div>

    <div class="mine__logout">
      <van-button round block plain type="danger" @click="logout">退出登录</van-button>
    </div>

    <van-dialog v-model:show="editing" title="修改资料" show-cancel-button @confirm="saveName">
      <van-field v-model="nickname" label="昵称" placeholder="输入新昵称" maxlength="30" />
      <van-field label="性别">
        <template #input>
          <van-radio-group v-model="gender" direction="horizontal">
            <van-radio name="female" checked-color="#ff5a5f">女</van-radio>
            <van-radio name="male" checked-color="#ff5a5f">男</van-radio>
          </van-radio-group>
        </template>
      </van-field>
    </van-dialog>

    <van-dialog v-model:show="showRecharge" title="余额充值（模拟）" show-cancel-button :confirm-button-loading="recharging" @confirm="recharge">
      <div class="mine__recharge">
        <div
          v-for="a in [50, 100, 200, 500]"
          :key="a"
          class="mine__recharge-opt"
          :class="{ 'mine__recharge-opt--on': rechargeAmount === a }"
          @click="rechargeAmount = a"
        >
          ¥{{ a }}
        </div>
        <div class="mine__card">
          <van-field v-model="cardCode" placeholder="充值卡密（如 DPXXXXXXXX）" maxlength="20">
            <template #button>
              <van-button size="small" type="primary" plain :loading="redeeming" @click="redeem">兑换</van-button>
            </template>
          </van-field>
        </div>
      </div>
    </van-dialog>
  </div>
</template>

<style scoped>
.mine__hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 28px 20px 56px;
  background: linear-gradient(135deg, #ff5a5f, #ff8e53);
}
.mine__name {
  color: #fff;
  font-size: 20px;
  font-weight: 800;
}
.mine__mobile {
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  margin-top: 4px;
}
.mine__who {
  flex: 1;
}
.mine__avatar-wrap {
  position: relative;
}
.mine__avatar-edit {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.mine__wallet {
  margin: -36px 12px 0;
  position: relative;
  display: flex;
  padding: 16px 0;
}
.mine__wallet-item {
  flex: 1;
  text-align: center;
}
.mine__wallet-num {
  font-weight: 700;
  font-size: 17px;
}
.mine__menu {
  margin: 12px;
  overflow: hidden;
}
.mine__unread {
  margin-right: 6px;
  align-self: center;
}
.mine__recharge {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 16px;
}
.mine__recharge-opt {
  border: 1px solid #eee;
  border-radius: 8px;
  text-align: center;
  padding: 12px;
  font-weight: 600;
}
.mine__card {
  margin-top: 12px;
}
.mine__recharge-opt--on {
  border-color: #ff5a5f;
  color: #ff5a5f;
  background: #fff5f5;
}
.mine__logout {
  margin: 24px 16px;
}
</style>
