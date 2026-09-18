#!/usr/bin/env python3
"""全量冒烟测试：城市玩伴平台 API 回归。

用法: python3 scripts/smoke.py [base_url]
默认打 http://localhost:3000/api，需要后端已启动且 seed 已跑。
每次运行使用全新手机号，不受历史数据影响。
"""
import json
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000/api"
RUN = str(int(time.time()))[-6:]  # 本次运行唯一后缀
MOBILE = lambda tag: f"199{RUN}{tag}"  # 199 + 6位 + 2位tag = 11位

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(f"{name} {detail}")
    print(("✓" if ok else "✗"), name, detail)


def call(method, path, token=None, body=None, expect=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            res = json.loads(r.read())
            code = r.status
    except urllib.error.HTTPError as e:
        res = json.loads(e.read() or b"{}")
        code = e.code
    if expect is not None and code != expect:
        raise AssertionError(f"{method} {path} -> {code} (want {expect}): {res}")
    return code, res


def login(mobile, invite=None):
    _, r = call("POST", "/auth/sms/send", body={"mobile": mobile}, expect=201)
    body = {"mobile": mobile, "code": r["devCode"]}
    if invite:
        body["inviteCode"] = invite
    _, res = call("POST", "/auth/login", body=body, expect=201)
    return res["token"]


def main():
    print(f"=== smoke @ {BASE} run={RUN} ===")

    # ---------- 公开接口 ----------
    code, home = call("GET", "/home", expect=200)
    check("home", code == 200 and "recommend" in home and "banners" in home)
    code, plist = call("GET", "/partners?sort=rating&page=1", expect=200)
    check("partners.list", plist["total"] > 0)
    code, _ = call("GET", "/partners?keyword=" + urllib.parse.quote("不存在xyz"), expect=200)
    check("partners.search", code == 200)
    pid = plist["items"][0]["id"]
    code, pd = call("GET", f"/partners/{pid}", expect=200)
    check("partners.detail", code == 200 and "services" in pd and "userId" in pd)
    code, _ = call("GET", "/dynamics?page=1", expect=200)
    check("dynamics.feed", code == 200)
    code, _ = call("GET", "/admin/dashboard", expect=401)
    check("admin.no-auth 401", code == 401)

    # ---------- 用户注册/资料 ----------
    admin_tok = login("13800138000")
    ua_tok = login(MOBILE("01"))
    ub_tok = login(MOBILE("02"))
    code, prof = call("GET", "/user/profile", ua_tok, expect=200)
    check("user.profile", code == 200)
    code, prof = call("PUT", "/user/profile", ua_tok, {"nickname": f"冒烟{RUN}"}, expect=200)
    check("user.update", prof["nickname"] == f"冒烟{RUN}")
    code, _ = call("GET", "/user/service", ua_tok, expect=200)
    check("user.service", code == 200)
    code, _ = call("POST", "/user/recharge", ua_tok, {"amount": 1000}, expect=201)
    check("user.recharge", code == 201)
    code, _ = call("GET", "/user/follows", ua_tok, expect=200)
    check("user.follows", code == 200)
    code, _ = call("GET", "/user/blocks", ua_tok, expect=200)
    check("user.blocks", code == 200)

    # ---------- 分销 ----------
    code, ref = call("GET", "/user/referral", ua_tok, expect=200)
    check("referral.code", bool(ref["inviteCode"]))
    _, r = call("POST", "/user/bind-inviter", ua_tok, {"code": ref["inviteCode"]}, expect=400)
    check("referral.self-bind 400", True)
    uc_tok = login(MOBILE("03"), invite=ref["inviteCode"])
    code, refc = call("GET", "/user/referral", uc_tok, expect=200)
    check("referral.bind-on-register", refc["inviterNickname"] is not None)

    # ---------- 关注/拉黑 ----------
    code, _ = call("POST", f"/partners/{pid}/follow", ua_tok, expect=201)
    check("follow", code == 201)
    code, det = call("GET", f"/partners/{pid}", ua_tok, expect=200)
    check("follow.state", det["followed"] is True)
    peer_uid = pd["userId"]
    code, _ = call("POST", f"/user/block/{peer_uid}", ub_tok, expect=201)
    code, r = call("POST", "/chat/send", ub_tok, {"peerId": peer_uid, "content": "hi"}, expect=400)
    check("block.msg-rejected", code == 400)
    call("DELETE", f"/user/block/{peer_uid}", ub_tok, expect=200)

    # ---------- 聊天 ----------
    code, _ = call("POST", "/chat/send", ub_tok, {"peerId": peer_uid, "content": "冒烟测试消息"}, expect=201)
    check("chat.send", code == 201)
    code, convs = call("GET", "/chat/conversations", ub_tok, expect=200)
    check("chat.conversations", len(convs) > 0 and "peer" in convs[0])
    code, un = call("GET", "/chat/unread", ua_tok, expect=200)
    check("chat.unread", code == 200)
    ub_id = call("GET", "/user/profile", ub_tok, expect=200)[1]["id"]
    code, hist = call("GET", f"/chat/messages?peerId={ub_id}", login_from_partner_user(pd) or admin_tok, expect=200)
    check("chat.history", code == 200 and "items" in hist)
    code, r = call("POST", "/chat/send", ub_tok, {"peerId": ub_id, "content": "自聊"}, expect=400)
    check("chat.self-chat 400", code == 400)

    # ---------- 玩伴入驻/工作台 ----------
    pw_tok = login(MOBILE("04"))
    code, app = call("POST", "/partner/apply", pw_tok, {
        "city": "上海", "district": "徐汇区", "age": 25, "bio": "冒烟测试玩伴",
        "tags": ["陪逛", "拍照"], "photos": [],
        "services": [{"name": "陪逛", "price": 100, "unit": "小时", "miniNum": 1}],
    })
    check("partner.apply", code in (200, 201))
    code, pprof = call("GET", "/partner/profile", pw_tok, expect=200)
    check("partner.profile", pprof["auditStatus"] in ("pending", "approved"))
    # 管理员通过审核
    pending = call("GET", "/admin/partners?auditStatus=pending", admin_tok)[1]["items"]
    my_app = next((p for p in pending if p["mobile"] == MOBILE("04")), None)
    if my_app:
        call("POST", f"/admin/partners/{my_app['id']}/approve", admin_tok, expect=201)
        check("admin.partner-approve", True)
        pid2 = my_app["id"]
    else:
        check("admin.partner-approve", False, "no pending found")
        pid2 = pid
    code, _ = call("PUT", "/partner/status", pw_tok, {"status": "rest"}, expect=200)
    check("partner.status", code == 200)
    call("PUT", "/partner/status", pw_tok, {"status": "available"}, expect=200)
    code, _ = call("GET", "/partner/orders?status=pending_accept", pw_tok, expect=200)
    check("partner.orders", code == 200)
    code, _ = call("GET", "/partner/wallet", pw_tok, expect=200)
    check("partner.wallet", code == 200)
    code, _ = call("GET", "/partner/reviews", pw_tok, expect=200)
    check("partner.reviews", code == 200)

    # ---------- 券 ----------
    code, claimable = call("GET", "/coupons/claimable", ua_tok, expect=200)
    check("coupons.claimable", code == 200)
    c0 = next((c for c in claimable if not c["claimed"] and (c["left"] == -1 or c["left"] > 0)), None)
    if c0:
        code, _ = call("POST", f"/coupons/{c0['id']}/claim", ua_tok, expect=201)
        check("coupons.claim", code == 201)
    code, mine = call("GET", "/coupons/mine", ua_tok, expect=200)
    check("coupons.mine", len(mine) > 0)

    # ---------- 下单→支付→玩伴履约→评价 ----------
    _, pd2 = call("GET", f"/partners/{pid2}", ua_tok, expect=200)
    svc2 = pd2["services"][0]
    code, order = call("POST", "/orders", ua_tok, {
        "partnerId": pid2,
        "items": [{"serviceId": svc2["id"], "num": svc2["miniNum"]}],
        "appointAt": "2030-01-01T10:00:00.000Z",
        "address": "冒烟地址", "remark": "smoke",
    }, expect=201)
    check("order.create", code == 201)
    oid = order["id"]
    code, _ = call("POST", f"/orders/{oid}/pay", ua_tok, {"method": "balance"}, expect=201)
    check("order.pay-balance", code == 201)
    code, r = call("POST", f"/orders/{oid}/urge", ua_tok)
    check("order.urge", code in (200, 201, 400), f"({code} 冷却限制属正常)")
    for act in ["accept", "start", "finish"]:
        code, _ = call("POST", f"/partner/orders/{oid}/{act}", pw_tok, expect=201)
    code, od = call("GET", f"/orders/{oid}", ua_tok, expect=200)
    check("order.lifecycle-done", od["status"] == "done", od["status"])
    code, _ = call("POST", f"/orders/{oid}/review", ua_tok, {"rating": 5, "content": "冒烟好评"}, expect=201)
    check("order.review", code == 201)

    # ---------- 佣金结算（uc 是 ua 的下线，需 uc 下单）----------
    call("POST", "/user/recharge", uc_tok, {"amount": 500})
    code, o2 = call("POST", "/orders", uc_tok, {
        "partnerId": pid2,
        "items": [{"serviceId": svc2["id"], "num": svc2["miniNum"]}],
        "appointAt": "2030-01-02T10:00:00.000Z",
    }, expect=201)
    oid2 = o2["id"]
    call("POST", f"/orders/{oid2}/pay", uc_tok, {"method": "balance"}, expect=201)
    for act in ["accept", "start", "finish"]:
        call("POST", f"/partner/orders/{oid2}/{act}", pw_tok, expect=201)
    code, ref2 = call("GET", "/user/referral", ua_tok, expect=200)
    check("commission.settled", ref2["totalCommission"] > 0, f"¥{ref2['totalCommission']}")

    # ---------- 玩伴提现 ----------
    code, w = call("POST", "/partner/withdraw", pw_tok, {"amount": 10}, expect=201)
    check("partner.withdraw", code == 201)
    wds = call("GET", "/admin/withdrawals?status=pending", admin_tok)[1]
    mine_wd = next((x for x in wds if x["id"] == w["id"]), None)
    if mine_wd:
        call("POST", f"/admin/withdrawals/{w['id']}/approve", admin_tok, expect=201)
    check("admin.withdrawal-approve", mine_wd is not None)

    # ---------- 业务逻辑回归 ----------
    # 过去时间下单被拒
    code, _ = call("POST", "/orders", ua_tok, {
        "partnerId": pid2,
        "items": [{"serviceId": svc2["id"], "num": svc2["miniNum"]}],
        "appointAt": "2000-01-01T00:00:00.000Z",
    }, expect=400)
    check("order.past-appoint 400", code == 400)

    # 重复支付被拒
    code, _ = call("POST", f"/orders/{oid}/pay", ua_tok, {"method": "balance"}, expect=400)
    check("order.dup-pay 400", code == 400)

    # 重复评价被拒
    code, _ = call("POST", f"/orders/{oid}/review", ua_tok, {"rating": 4, "content": "重复评价"}, expect=400)
    check("order.dup-review 400", code == 400)

    # 未支付取消退券 → 已支付拒单退款退券
    call("POST", "/user/recharge", ub_tok, {"amount": 1000})
    code, claimable2 = call("GET", "/coupons/claimable", ub_tok, expect=200)
    goods = svc2["price"] * svc2["miniNum"]
    c1 = next((c for c in claimable2 if not c["claimed"] and (c["left"] == -1 or c["left"] > 0) and c["minSpend"] <= goods), None)
    uc_row = None
    if c1:
        call("POST", f"/coupons/{c1['id']}/claim", ub_tok, expect=201)
        code, mine2 = call("GET", "/coupons/mine", ub_tok, expect=200)
        uc_row = next((m for m in mine2 if m["title"] == c1["title"] and not m["used"]), None)
    if uc_row:
        code, o3 = call("POST", "/orders", ub_tok, {
            "partnerId": pid2,
            "items": [{"serviceId": svc2["id"], "num": svc2["miniNum"]}],
            "appointAt": "2030-01-03T10:00:00.000Z",
            "userCouponId": uc_row["id"],
        }, expect=201)
        call("POST", f"/orders/{o3['id']}/cancel", ub_tok, {"reason": "不要了"}, expect=201)
        code, mine3 = call("GET", "/coupons/mine", ub_tok, expect=200)
        restored = next((m for m in mine3 if m["id"] == uc_row["id"]), None)
        check("coupon.released-on-cancel", restored is not None and not restored["used"])

        # 用退回的券再下单→余额支付→玩伴拒单→退款退券
        code, o4 = call("POST", "/orders", ub_tok, {
            "partnerId": pid2,
            "items": [{"serviceId": svc2["id"], "num": svc2["miniNum"]}],
            "appointAt": "2030-01-03T11:00:00.000Z",
            "userCouponId": uc_row["id"],
        }, expect=201)
        _, b1 = call("GET", "/user/profile", ub_tok, expect=200)
        call("POST", f"/orders/{o4['id']}/pay", ub_tok, {"method": "balance"}, expect=201)
        call("POST", f"/partner/orders/{o4['id']}/reject", pw_tok, expect=201)
        _, b2 = call("GET", "/user/profile", ub_tok, expect=200)
        code, od4 = call("GET", f"/orders/{o4['id']}", ub_tok, expect=200)
        check("order.reject-status", od4["status"] == "rejected", od4["status"])
        check("order.reject-refund", b2["balance"] == b1["balance"], f"{b1['balance']}->{b2['balance']}")
        code, mine4 = call("GET", "/coupons/mine", ub_tok, expect=200)
        restored2 = next((m for m in mine4 if m["id"] == uc_row["id"]), None)
        check("coupon.released-on-reject", restored2 is not None and not restored2["used"])
    else:
        check("coupon.released-on-cancel", False, "无可领券")
        check("order.reject-refund", False, "无可领券")
        check("coupon.released-on-reject", False, "无可领券")

    # 已支付取消：全额退款
    code, o5 = call("POST", "/orders", ub_tok, {
        "partnerId": pid2,
        "items": [{"serviceId": svc2["id"], "num": svc2["miniNum"]}],
        "appointAt": "2030-01-05T10:00:00.000Z",
    }, expect=201)
    _, b1 = call("GET", "/user/profile", ub_tok, expect=200)
    call("POST", f"/orders/{o5['id']}/pay", ub_tok, {"method": "balance"}, expect=201)
    call("POST", f"/orders/{o5['id']}/cancel", ub_tok, {"reason": "测试取消"}, expect=201)
    _, b2 = call("GET", "/user/profile", ub_tok, expect=200)
    code, od5 = call("GET", f"/orders/{o5['id']}", ub_tok, expect=200)
    check("order.paid-cancel-refunded", od5["status"] == "refunded", od5["status"])
    check("order.paid-cancel-refund", b2["balance"] == b1["balance"])

    # 加钟起购校验：玩伴服务改为起购2（改资料回炉审核 → 管理端重新通过）
    call("PUT", "/partner/profile", pw_tok, {
        "city": "上海", "district": "徐汇区", "age": 25, "bio": "冒烟测试玩伴",
        "tags": ["陪逛"], "photos": [],
        "services": [{"name": "陪逛", "price": 100, "unit": "小时", "miniNum": 2}],
    }, expect=200)
    _, pprof2 = call("GET", "/partner/profile", pw_tok, expect=200)
    check("partner.reaudit-pending", pprof2["auditStatus"] == "pending", pprof2["auditStatus"])
    call("POST", f"/admin/partners/{pid2}/approve", admin_tok, expect=201)
    call("PUT", "/partner/status", pw_tok, {"status": "available"}, expect=200)
    _, pd3 = call("GET", f"/partners/{pid2}", ua_tok, expect=200)
    svc3 = pd3["services"][0]
    code, o6 = call("POST", "/orders", ub_tok, {
        "partnerId": pid2,
        "items": [{"serviceId": svc3["id"], "num": 2}],
        "appointAt": "2030-01-06T10:00:00.000Z",
    }, expect=201)
    call("POST", f"/orders/{o6['id']}/pay", ub_tok, {"method": "balance"}, expect=201)
    call("POST", f"/partner/orders/{o6['id']}/accept", pw_tok, expect=201)
    code, _ = call("POST", f"/orders/{o6['id']}/extend", ub_tok, {"items": [{"serviceId": svc3["id"], "num": 1}]}, expect=400)
    check("order.extend-minNum 400", code == 400)
    code, _ = call("POST", f"/orders/{o6['id']}/extend", ub_tok, {"items": [{"serviceId": svc3["id"], "num": 2}]}, expect=201)
    check("order.extend-ok", code == 201)

    # 评价回复：敏感词拦截 + 正常回复
    code, revs = call("GET", "/partner/reviews", pw_tok, expect=200)
    rv = next((r for r in revs if r["content"] == "冒烟好评" and not r["reply"]), None)
    if rv:
        code, _ = call("POST", f"/partner/reviews/{rv['id']}/reply", pw_tok, {"content": "小心诈骗哦"}, expect=400)
        check("review.reply-sensitive 400", code == 400)
        code, _ = call("POST", f"/partner/reviews/{rv['id']}/reply", pw_tok, {"content": "谢谢支持"}, expect=201)
        check("review.reply-ok", code == 201)
    else:
        check("review.reply-ok", False, "no review found")

    # 禁用用户存量 JWT 失效
    call("PUT", f"/admin/users/{ub_id}/disabled", admin_tok, {"disabled": True}, expect=200)
    code, _ = call("GET", "/user/profile", ub_tok, expect=401)
    check("disabled.jwt 401", code == 401)
    call("PUT", f"/admin/users/{ub_id}/disabled", admin_tok, {"disabled": False}, expect=200)

    # 加钟级联：父单取消 → 未支付子单同步取消；子订单禁止再加钟/评价
    code, child = call("POST", f"/orders/{o6['id']}/extend", ub_tok, {"items": [{"serviceId": svc3["id"], "num": 2}]}, expect=201)
    if code == 201:
        cid = child["id"]
        code, _ = call("POST", f"/orders/{cid}/extend", ub_tok, {"items": [{"serviceId": svc3["id"], "num": 2}]}, expect=400)
        check("order.extend-grandchild 400", code == 400)
        code, _ = call("POST", f"/orders/{cid}/review", ub_tok, {"rating": 5, "content": "x"}, expect=400)
        check("order.child-review 400", code == 400)
        call("POST", f"/orders/{o6['id']}/cancel", ub_tok, {"reason": "级联测试"}, expect=201)
        _, cd = call("GET", f"/orders/{cid}", ub_tok, expect=200)
        check("order.cascade-child-cancelled", cd["status"] == "cancelled", cd["status"])
    else:
        check("order.extend-grandchild 400", False, "extend failed")

    # 分销环：uc 已绑 ua 为推荐人，ua 再绑 uc 应被拒（成环）
    _, refc2 = call("GET", "/user/referral", uc_tok, expect=200)
    code, _ = call("POST", "/user/bind-inviter", ua_tok, {"inviteCode": refc2["inviteCode"]}, expect=400)
    check("referral.cycle 400", code == 400)

    # ---------- 动态 ----------
    code, d = call("POST", "/dynamics", ua_tok, {"content": f"冒烟动态{RUN}", "city": "上海"}, expect=201)
    check("dynamic.create", code == 201)
    did = d["id"]
    code, _ = call("POST", f"/dynamics/{did}/like", ub_tok, expect=201)
    check("dynamic.like", code == 201)
    code, cmt = call("POST", f"/dynamics/{did}/comments", ub_tok, {"content": "冒烟评论"}, expect=201)
    check("dynamic.comment", code == 201)
    # 评论删除：本人可删
    code, _ = call("DELETE", f"/dynamics/comments/{cmt['id']}", ub_tok, expect=200)
    check("dynamic.comment-delete", code == 200)
    call("POST", f"/dynamics/{did}/comments", ub_tok, {"content": "再评一条"}, expect=201)
    # 拉黑阻断：ua 拉黑 ub 后，ub 点赞/评论/私信均被拒
    call("POST", f"/user/block/{ub_id}", ua_tok, expect=201)
    code, _ = call("POST", f"/dynamics/{did}/like", ub_tok, expect=403)
    check("block.like 403", code == 403)
    code, _ = call("POST", f"/dynamics/{did}/comments", ub_tok, {"content": "被拉黑"}, expect=403)
    check("block.comment 403", code == 403)
    code, _ = call("POST", "/chat/send", ub_tok, {"peerId": prof["id"], "content": "在吗"}, expect=400)
    check("block.chat 400", code == 400)
    call("DELETE", f"/user/block/{ub_id}", ua_tok, expect=200)
    code, _ = call("GET", f"/dynamics/{did}/comments", ua_tok, expect=200)
    check("dynamic.comments", code == 200)
    code, fd = call("GET", "/dynamics?tab=follow", ua_tok, expect=200)
    check("dynamic.follow-tab", code == 200)
    code, mine_d = call("GET", "/dynamics/mine", ua_tok, expect=200)
    check("dynamic.mine", any(x["id"] == did for x in mine_d))
    code, _ = call("DELETE", f"/dynamics/{did}", ua_tok, expect=200)
    check("dynamic.delete", code == 200)
    code, r = call("POST", "/dynamics", ua_tok, {"content": "测试诈骗内容"}, expect=400)
    check("dynamic.sensitive-400", code == 400)

    # ---------- 管理端全接口 ----------
    code, dash = call("GET", "/admin/dashboard", admin_tok, expect=200)
    check("admin.dashboard", all(k in dash for k in ["userCount", "gmv", "pendingWithdrawals", "commissionTotal"]))
    code, _ = call("GET", "/admin/users?keyword=199", admin_tok, expect=200)
    check("admin.users-search", code == 200)
    code, ud = call("GET", f"/admin/users/{prof['id']}", admin_tok, expect=200)
    check("admin.user-detail", "recentOrders" in ud)
    code, _ = call("POST", f"/admin/users/{prof['id']}/balance", admin_tok, {"amount": 1}, expect=201)
    check("admin.balance-adjust", code == 201)
    code, _ = call("GET", "/admin/orders?status=done", admin_tok, expect=200)
    check("admin.orders-filter", code == 200)
    code, _ = call("GET", "/admin/orders?keyword=DP", admin_tok, expect=200)
    check("admin.orders-search", code == 200)
    code, _ = call("GET", "/admin/reviews", admin_tok, expect=200)
    check("admin.reviews", code == 200)
    code, _ = call("GET", "/admin/dynamics", admin_tok, expect=200)
    check("admin.dynamics", code == 200)
    code, _ = call("GET", "/admin/banners", admin_tok, expect=200)
    check("admin.banners", code == 200)
    code, _ = call("GET", "/admin/coupons", admin_tok, expect=200)
    check("admin.coupons", code == 200)
    code, _ = call("GET", "/admin/commissions", admin_tok, expect=200)
    check("admin.commissions", code == 200)
    code, st = call("GET", "/admin/settings", admin_tok, expect=200)
    check("admin.settings", "commissionRate" in st and "sensitiveWords" in st)
    code, _ = call("PUT", "/admin/partners/" + pid2 + "/recommend", admin_tok, {"recommended": True}, expect=200)
    check("admin.recommend", code == 200)
    code, _ = call("PUT", f"/admin/users/{prof['id']}/disabled", admin_tok, {"disabled": True}, expect=200)
    _, sms = call("POST", "/auth/sms/send", body={"mobile": prof["mobile"]}, expect=201)
    code, r = call("POST", "/auth/login", body={"mobile": prof["mobile"], "code": sms["devCode"]}, expect=401)
    check("admin.disabled-login 401", "禁用" in r.get("message", ""))
    call("PUT", f"/admin/users/{prof['id']}/disabled", admin_tok, {"disabled": False}, expect=200)
    # 非管理员访问
    code, _ = call("GET", "/admin/dashboard", ua_tok, expect=403)
    check("admin.non-admin 403", code == 403)

    print(f"\n=== {len(PASS)} passed, {len(FAIL)} failed ===")
    for f in FAIL:
        print("FAIL:", f)
    sys.exit(1 if FAIL else 0)


def login_from_partner_user(pd):
    """登录玩伴对应用户（mobile 未知时跳过）。"""
    try:
        partners_admin = None
        # 通过管理端找该玩伴 user 的 mobile
        _, res = call("POST", "/auth/sms/send", body={"mobile": "13800138000"}, expect=201)
        _, res = call("POST", "/auth/login", body={"mobile": "13800138000", "code": res["devCode"]}, expect=201)
        admin = res["token"]
        _, rows = call("GET", "/admin/partners?auditStatus=all", admin, expect=200)
        m = next((p["mobile"] for p in rows["items"] if p["id"] == pd["id"]), None)
        if m:
            return login(m)
    except Exception:
        pass
    return None


if __name__ == "__main__":
    main()
