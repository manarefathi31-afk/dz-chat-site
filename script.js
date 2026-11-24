const SUPABASE_URL = "https://knjxiberzbxncbfzbzjh.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ton9lLhZhEYvXyyoPYUfVw_iIpqnc1W";
const STORAGE_BUCKET = "dz-chat-media";

if (!window.supabase) {
  alert("تعذر تحميل مكتبة Supabase. تأكد من الاتصال بالإنترنت.");
  throw new Error("Supabase not loaded");
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);

function safeUrl(url, allowDataMedia = false) {
  if (!url || typeof url !== "string") return "";
  const u = url.trim();
  if (u.startsWith("./") || u.startsWith("/") || u.startsWith("blob:")) return u;
  if (allowDataMedia && /^data:(image\/(png|jpeg|jpg|gif|webp)|audio\/(webm|mp4|ogg|mpeg|wav));base64,/i.test(u)) return u;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
  } catch {}
  return "";
}
function safeCssBgUrl(url) {
  const s = safeUrl(url, false);
  return s ? s.replace(/["'()\\]/g, encodeURIComponent) : "";
}
function isSafeImageFile(file, maxMb = 5) {
  if (!file) return false;
  if (/svg/i.test(file.type || file.name || "")) { showToast("صيغة SVG غير مسموحة لأسباب أمنية"); return false; }
  const extOk = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name || "");
  const mimeOk = !file.type || /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.type);
  if (!mimeOk || (!file.type && !extOk)) { showToast("يرجى اختيار صورة صالحة (JPG / PNG / WEBP)"); return false; }
  if (file.size > maxMb * 1024 * 1024) { showToast(`حجم الصورة يجب أن يكون أقل من ${maxMb} ميغابايت`); return false; }
  return true;
}
function isSafeVideoOrImageFile(file, maxMb = 50) {
  if (!file) return null;
  if (/svg/i.test(file.type || file.name || "")) { showToast("صيغة SVG غير مسموحة لأسباب أمنية"); return null; }
  const isImg = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.type) || /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name || "");
  const isVid = /^video\/(mp4|quicktime|webm|x-matroska|3gpp)$/i.test(file.type) || file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|3gp)$/i.test(file.name || "");
  if (!isImg && !isVid) { showToast("اختر صورة أو فيديو صالحاً"); return null; }
  if (file.size > maxMb * 1024 * 1024) { showToast(`حجم الملف أكبر من ${maxMb} MB`); return null; }
  return isImg ? "image" : "video";
}
function cleanText(str, maxLen = 500) {
  return String(str || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, maxLen);
}
const _rateMap = {};
function checkRateLimit(key, ms = 450) {
  const now = Date.now();
  if (_rateMap[key] && now - _rateMap[key] < ms) return false;
  _rateMap[key] = now;
  return true;
}

let currentUser = null, currentProfile = null, profilesMap = {};
let videosCache = [], likesCache = [], commentsCache = [], followsCache = [], liveRoomsCache = [], allMessagesCache = [];
let onlineUserIds = new Set(), showOnlineStatus = true, presenceChannel = null, realtimeChannel = null;
let selectedMedia = null, selectedMediaType = "video";
let activeCommentVideoId = null, activeSharePost = null, activeOptionsPost = null;
let activeEditPost = null, editPostMediaFile = null, editPostMediaType = null;
let activeChatUserId = "__none__", activeProfileTab = "posts", activeFollowsTab = "following";
let viewedUserProfileId = null, viewedUserProfileTab = "posts", chatSearchQuery = "";
let feedObserver = null, friendsFeedObserver = null;

let activeLiveRoom = null, selectedLiveMode = "video", pendingPinRoom = null;
let liveSeatsCache = [], liveCommentsCache = [], liveRoomChannel = null;
let localMediaStream = null, remoteMediaStreams = {}, amISpeakerNow = false;
let livekitRoom = null, liveMusicAudioTrack = null, liveSpeakerSyncLock = false;
let knownLiveRoomIds = new Set(), initialRoomsLoaded = false;
let isMicMuted = false, isCamEnabled = true, currentCamFacing = "user";
let seatDecorMap = {}, mySeatDecorUrl = "";
let liveMusicAudio = null, liveAudioCtx = null, liveMixedDest = null, notifyAudioCtx = null;
let voiceRecorder = null, voiceChunks = [], voiceTimerInt = null, voiceSeconds = 0, voiceMimeType = "";
let swReg = null, activeActionMsg = null, activeActionMsgParsed = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then(r => { swReg = r; }).catch(() => {});
  navigator.serviceWorker.addEventListener("message", ev => {
    if (ev.data?.type !== "dz-notify-click" || !currentUser) return;
    const d = ev.data.data || {};
    if (d.kind === "msg" && d.senderId !== undefined) openPrivateChat(d.senderId);
    else if (d.kind === "live" && d.roomId) {
      const rm = liveRoomsCache.find(r => r.id === d.roomId);
      if (rm) tryEnterLiveRoom(rm);
    }
  });
}

const seatPhotoInput = document.createElement("input");
seatPhotoInput.type = "file"; seatPhotoInput.accept = "image/jpeg,image/png,image/webp,image/gif"; seatPhotoInput.hidden = true;
document.body.appendChild(seatPhotoInput);

const topNotifyEl = document.createElement("div");
topNotifyEl.id = "dzTopNotify"; topNotifyEl.className = "dz-top-notify";
topNotifyEl.innerHTML = `<div class="dz-top-notify-av" id="dzTopNotifyAv">🇩🇿</div><div class="dz-top-notify-body"><strong id="dzTopNotifyTitle"></strong><small id="dzTopNotifyText"></small></div>`;
document.body.appendChild(topNotifyEl);
let topNotifyTimer = null, topNotifyAction = null;
topNotifyEl.addEventListener("click", () => {
  topNotifyEl.classList.remove("show");
  if (!currentUser || !topNotifyAction) return;
  if (topNotifyAction.kind === "msg" && topNotifyAction.senderId !== undefined) openPrivateChat(topNotifyAction.senderId);
  else if (topNotifyAction.kind === "live" && topNotifyAction.roomId) {
    const rm = liveRoomsCache.find(r => r.id === topNotifyAction.roomId);
    if (rm) tryEnterLiveRoom(rm);
  }
});

const enableNotifyBtn = document.createElement("button");
enableNotifyBtn.type = "button";
enableNotifyBtn.id = "dzEnableNotifyBtn";
enableNotifyBtn.textContent = "🔔 تفعيل إشعارات الهاتف";
enableNotifyBtn.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;background:#07845b;color:#fff;border:none;border-radius:20px;padding:7px 14px;font-size:12px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;";
enableNotifyBtn.hidden = true;
document.body.appendChild(enableNotifyBtn);

function refreshNotifyBtnVisibility() {
  enableNotifyBtn.hidden = !currentUser || !("Notification" in window) || Notification.permission !== "default";
}
enableNotifyBtn.addEventListener("click", async () => {
  unlockNotifyAudio();
  if ("Notification" in window) {
    try {
      const res = await Notification.requestPermission();
      refreshNotifyBtnVisibility();
      if (res === "granted") { playMsgNotificationSound(); showToast("تم تفعيل إشعارات الهاتف بنجاح 🔔"); }
      else showToast("يرجى السماح بالإشعارات من إعدادات المتصفح");
    } catch {}
  }
});

const liveRoomEl = $("dzLiveRoom");
const liveAudioUnlockBtn = document.createElement("button");
liveAudioUnlockBtn.type = "button";
liveAudioUnlockBtn.className = "live-audio-unlock";
liveAudioUnlockBtn.textContent = "🔊 اضغط هنا لتفعيل صوت البث";
liveAudioUnlockBtn.hidden = true;
if (liveRoomEl && $("liveStageGridWrap")) liveRoomEl.insertBefore(liveAudioUnlockBtn, $("liveStageGridWrap"));

function unlockNotifyAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!notifyAudioCtx) notifyAudioCtx = new Ctx();
    if (notifyAudioCtx.state === "suspended") notifyAudioCtx.resume();
  } catch {}
}
document.addEventListener("touchstart", unlockNotifyAudio, { passive: true });
document.addEventListener("click", unlockNotifyAudio, { passive: true });

function playMsgNotificationSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!notifyAudioCtx) notifyAudioCtx = new Ctx();
    if (notifyAudioCtx.state === "suspended") notifyAudioCtx.resume();
    const now = notifyAudioCtx.currentTime;
    const playTone = (freq, start, dur) => {
      const osc = notifyAudioCtx.createOscillator(), gain = notifyAudioCtx.createGain();
      osc.type = "sine"; osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.32, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain); gain.connect(notifyAudioCtx.destination);
      osc.start(start); osc.stop(start + dur);
    };
    playTone(880, now, 0.13);
    playTone(1244, now + 0.12, 0.2);
  } catch {}
}

function playLiveNotificationSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!notifyAudioCtx) notifyAudioCtx = new Ctx();
    if (notifyAudioCtx.state === "suspended") notifyAudioCtx.resume();
    const now = notifyAudioCtx.currentTime;
    const playTone = (freq, start, dur) => {
      const osc = notifyAudioCtx.createOscillator(), gain = notifyAudioCtx.createGain();
      osc.type = "triangle"; osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain); gain.connect(notifyAudioCtx.destination);
      osc.start(start); osc.stop(start + dur);
    };
    playTone(660, now, 0.12); playTone(880, now + 0.12, 0.12); playTone(1320, now + 0.24, 0.24);
  } catch {}
}
async function sendSystemNotification(title, body, icon, data = {}, tag = "dz-notify") {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const safeIcon = safeUrl(icon, false) || undefined;
  const opts = { body, icon: safeIcon, badge: safeIcon, data, tag, renotify: true, vibrate: [180, 80, 180] };
  try {
    const reg = swReg || (navigator.serviceWorker ? await navigator.serviceWorker.getRegistration("./") : null);
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return; }
  } catch {}
  try {
    const n = new Notification(title, opts);
    n.onclick = () => {
      window.focus();
      if (data.kind === "msg" && data.senderId !== undefined) openPrivateChat(data.senderId);
      else if (data.kind === "live" && data.roomId) {
        const rm = liveRoomsCache.find(r => r.id === data.roomId);
        if (rm) tryEnterLiveRoom(rm);
      }
    };
  } catch {}
}

function showTopMessageNotification(senderProfile, previewText, senderId) {
  playMsgNotificationSound();
  const uname = senderProfile?.username || "صديق";
  topNotifyAction = { kind: "msg", senderId };
  setAvatarContent($("dzTopNotifyAv"), senderProfile?.avatar_url, uname);
  $("dzTopNotifyTitle").textContent = "رسالة جديدة من @" + uname;
  $("dzTopNotifyText").textContent = previewText || "رسالة جديدة";
  topNotifyEl.classList.add("show");
  clearTimeout(topNotifyTimer);
  topNotifyTimer = setTimeout(() => topNotifyEl.classList.remove("show"), 4500);
  sendSystemNotification("رسالة جديدة من @" + uname, previewText || "رسالة جديدة", senderProfile?.avatar_url, { kind: "msg", senderId }, "dz-msg-" + (senderId || "pub"));
}

function showTopLiveNotification(hostProfile, room) {
  playLiveNotificationSound();
  const uname = hostProfile?.username || "صديق";
  const meta = parseRoomMeta(room.title);
  topNotifyAction = { kind: "live", roomId: room.id };
  setAvatarContent($("dzTopNotifyAv"), hostProfile?.avatar_url, uname);
  $("dzTopNotifyTitle").textContent = `🔴 @${uname} بدأ بثاً مباشراً الآن!`;
  $("dzTopNotifyText").textContent = meta.t || "اضغط للدخول إلى البث";
  topNotifyEl.classList.add("show");
  clearTimeout(topNotifyTimer);
  topNotifyTimer = setTimeout(() => topNotifyEl.classList.remove("show"), 5500);
  sendSystemNotification(`🔴 @${uname} في بث مباشر الآن`, meta.t || "اضغط للدخول إلى البث", hostProfile?.avatar_url, { kind: "live", roomId: room.id }, "dz-live-" + room.id);
}

/* === إعدادات الخاص + حالة القراءة + تحديث النشاط التلقائي === */
function getAllChatPrefs() {
  if (!currentUser) return {};
  try { return JSON.parse(localStorage.getItem("dz_chat_prefs_" + currentUser.id) || "{}"); } catch { return {}; }
}
function getUserChatPrefs(uid) {
  if (!uid) return {};
  return getAllChatPrefs()[uid] || {};
}
function setUserChatPref(uid, patch) {
  if (!currentUser || !uid) return;
  const all = getAllChatPrefs();
  all[uid] = { ...(all[uid] || {}), ...patch };
  localStorage.setItem("dz_chat_prefs_" + currentUser.id, JSON.stringify(all));
}
function isUserBlocked(uid) { return !!getUserChatPrefs(uid).blocked; }
function isUserMsgMuted(uid) { const p = getUserChatPrefs(uid); return !!(p.blocked || p.muteMsgs); }
function isUserCallMuted(uid) { const p = getUserChatPrefs(uid); return !!(p.blocked || p.muteCalls); }
function isUserPinned(uid) { return !!getUserChatPrefs(uid).pinned; }
function isUserNotifyAll(uid) { return !!getUserChatPrefs(uid).notifyAll; }

function getChatReadMap() {
  if (!currentUser) return {};
  try { return JSON.parse(localStorage.getItem("dz_chat_read_" + currentUser.id) || "{}"); } catch { return {}; }
}
function markChatAsRead(peerId, latestMs) {
  if (!currentUser) return;
  const key = peerId === null ? "__public__" : peerId;
  const map = getChatReadMap();
  const nextTs = Math.max(map[key] || 0, latestMs || Date.now());
  map[key] = nextTs;
  localStorage.setItem("dz_chat_read_" + currentUser.id, JSON.stringify(map));
}
function getUnreadCountForPeer(peerId) {
  if (!currentUser || !peerId || isUserBlocked(peerId)) return 0;
  const lastRead = getChatReadMap()[peerId] || 0;
  return allMessagesCache.filter(m =>
    m.sender_id === peerId && m.receiver_id === currentUser.id && new Date(m.created_at).getTime() > lastRead
  ).length;
}
function getCurrentActivityKeys() {
  if (!currentUser) return [];
  const myPostIds = new Set(videosCache.filter(v => v.user_id === currentUser.id).map(v => v.id));
  const keys = [];
  likesCache.forEach(l => { if (myPostIds.has(l.video_id) && l.user_id !== currentUser.id) keys.push(`l:${l.video_id}:${l.user_id}`); });
  followsCache.forEach(f => { if (f.following_id === currentUser.id) keys.push(`f:${f.follower_id}`); });
  return keys;
}
function getSeenActivitySet() {
  if (!currentUser) return new Set();
  try { return new Set(JSON.parse(localStorage.getItem("dz_act_seen_" + currentUser.id) || "[]")); } catch { return new Set(); }
}
function getUnreadActivityCount() {
  const seen = getSeenActivitySet();
  return getCurrentActivityKeys().filter(k => !seen.has(k)).length;
}
function markActivityAsRead() {
  if (!currentUser) return;
  localStorage.setItem("dz_act_seen_" + currentUser.id, JSON.stringify(getCurrentActivityKeys()));
  renderInbox();
}

function formatCount(n) { return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n); }
function formatRelTime(iso) {
  if (!iso) return "";
  const d = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (d < 60) return `منذ ${d} د`;
  const h = Math.floor(d / 60);
  return h < 24 ? `منذ ${h} س` : `منذ ${Math.floor(h / 24)} ي`;
}
function isImagePost(post) {
  if (post.media_type === "image") return true;
  if (post.media_type === "video") return false;
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(post.video_url || "");
}
function showToast(msg) {
  const box = $("toast"); if (!box) return;
  box.textContent = msg; box.classList.add("show");
  clearTimeout(box._timer); box._timer = setTimeout(() => box.classList.remove("show"), 3200);
}
function authMessage(msg, error = false) {
  const box = $("dzAuthMessage"); if (!box) return;
  box.textContent = msg; box.style.color = error ? "#dc2626" : "#07845b";
}
function setAvatarContent(el, url, alt = "صورة") {
  if (!el) return;
  el.textContent = "";
  const safe = safeUrl(url, true);
  if (safe) { const img = document.createElement("img"); img.src = safe; img.alt = alt; el.appendChild(img); }
  else el.textContent = "🇩🇿";
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("تعذر قراءة التسجيل")); r.readAsDataURL(blob);
  });
}
function attachSwipeBack(el, onBack) {
  if (!el) return;
  let sx = 0, sy = 0, ok = false;
  el.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || e.target.closest("input[type=range], .dm-quick-bar, .inbox-stories-strip, .live-share-friends-row, .follows-tabs, .gifts-targets-row")) { ok = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; ok = true;
  }, { passive: true });
  el.addEventListener("touchend", e => {
    if (!ok || !e.changedTouches.length) return;
    ok = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (dx < -70 && Math.abs(dx) > Math.abs(dy) * 1.4 && Math.abs(dy) < 95) onBack();
  }, { passive: true });
}
function attachLongPress(el, onLongPress) {
  if (!el) return;
  let timer = null, sx = 0, sy = 0;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || e.target.closest("button, audio, video")) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    timer = setTimeout(() => { timer = null; onLongPress(); }, 450);
  }, { passive: true });
  el.addEventListener("touchmove", e => {
    if (!timer || !e.touches.length) return;
    if (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10) clear();
  }, { passive: true });
  el.addEventListener("touchend", clear);
  el.addEventListener("touchcancel", clear);
  el.addEventListener("mousedown", e => {
    if (e.button !== 0 || e.target.closest("button, audio, video")) return;
    timer = setTimeout(() => { timer = null; onLongPress(); }, 450);
  });
  el.addEventListener("mouseup", clear);
  el.addEventListener("mouseleave", clear);
  el.addEventListener("contextmenu", e => { e.preventDefault(); clear(); onLongPress(); });
}

function getSavedPostIds() {
  if (!currentUser) return [];
  try { return JSON.parse(localStorage.getItem("dz_saved_" + currentUser.id) || "[]"); } catch { return []; }
}
function toggleSavedPostId(postId) {
  if (!currentUser) return false;
  const list = getSavedPostIds(), idx = list.indexOf(postId), saved = idx === -1;
  if (saved) list.unshift(postId); else list.splice(idx, 1);
  localStorage.setItem("dz_saved_" + currentUser.id, JSON.stringify(list));
  return saved;
}
function getUserThought() { return currentUser ? (localStorage.getItem("dz_thought_" + currentUser.id) || "") : ""; }
function setUserThought(txt) { if (currentUser) localStorage.setItem("dz_thought_" + currentUser.id, cleanText(txt, 100)); }

function parseRoomMeta(raw) {
  const fb = { t: raw || "غرفة لايف 🇩🇿", m: "audio", b: "default", p: "", s: "", bl: [], hc: false };
  if (!raw || typeof raw !== "string" || !raw.trim().startsWith("{")) return fb;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.t === "string") {
      return { t: o.t || fb.t, m: o.m || "audio", b: o.b || "default", p: o.p || "", s: o.s || "", bl: Array.isArray(o.bl) ? o.bl : [], hc: !!o.hc };
    }
  } catch {}
  return fb;
}
function packRoomMeta(m) {
  return JSON.stringify({
    t: cleanText(m.t, 80) || "غرفة لايف 🇩🇿", m: m.m || "audio", b: m.b || "default",
    p: m.p || "", s: m.s || "", bl: Array.isArray(m.bl) ? m.bl : [], hc: !!m.hc
  });
}
function parseMsgPayload(content) {
  if (!content || typeof content !== "string") return { kind: "text", text: "" };
  if (content.trim().startsWith("{")) {
    try {
      const p = JSON.parse(content);
      if (p && p.dz_share) return { kind: "share", ...p };
      if (p && p.dz_img) return { kind: "image", url: p.url, react: p.react || "" };
      if (p && p.dz_voice) return { kind: "voice", url: p.url, dur: p.dur || "", react: p.react || "" };
      if (p && p.dz_live_invite) return { kind: "live", roomId: p.roomId, title: p.title, hostName: p.hostName };
      if (p && p.dz_txt) return { kind: "text", text: p.text || "", react: p.react || "", edited: !!p.edited };
    } catch {}
  }
  return { kind: "text", text: content, react: "", edited: false };
}

const authScreen = document.createElement("div");
authScreen.id = "dzAuth";
authScreen.innerHTML = `<div class="auth-card"><div class="auth-flag">🇩🇿</div><h2>DZ-CHAT</h2><p class="auth-sub">سجّل باسم المستخدم وكلمة المرور فقط بدون تعقيدات</p><form id="dzLoginForm"><input id="dzEmail" type="text" placeholder="اسم المستخدم" required minlength="3" autocomplete="username"><input id="dzPassword" type="password" placeholder="كلمة المرور" required minlength="6" autocomplete="current-password"><button class="auth-main" type="submit">تسجيل الدخول</button></form><form id="dzRegisterForm" hidden><input id="dzName" type="text" placeholder="اسم المستخدم" required minlength="3" autocomplete="username"><input id="dzNewPassword" type="password" placeholder="كلمة المرور (6 أحرف على الأقل)" required minlength="6" autocomplete="new-password"><button class="auth-main" type="submit">إنشاء حساب جديد</button></form><button type="button" class="auth-switch" id="dzSwitch">ليس لديك حساب؟ أنشئ حساباً جديداً</button><div class="auth-message" id="dzAuthMessage"></div></div>`;
document.body.appendChild(authScreen);

const app = document.querySelector(".app"), pages = document.querySelectorAll(".page"), navItems = document.querySelectorAll(".nav-item");
function showApp() { authScreen.style.display = "none"; app.style.display = ""; refreshNotifyBtnVisibility(); }
function showAuth() {
  leaveLiveRoom(true); closePrivateChat(); closeUserProfile(); $("dzChatSettingsModal").hidden = true;
  currentUser = null; currentProfile = null; onlineUserIds = new Set(); initialRoomsLoaded = false; knownLiveRoomIds.clear();
  db.removeAllChannels(); presenceChannel = null; realtimeChannel = null;
  document.querySelectorAll("video").forEach(v => v.pause());
  app.style.display = "none"; authScreen.style.display = "flex"; refreshNotifyBtnVisibility();
}

let registerMode = false;
$("dzSwitch").addEventListener("click", () => {
  registerMode = !registerMode;
  $("dzLoginForm").hidden = registerMode; $("dzRegisterForm").hidden = !registerMode;
  $("dzSwitch").textContent = registerMode ? "لديك حساب؟ سجل الدخول" : "ليس لديك حساب؟ أنشئ حساباً جديداً";
  authMessage("");
});

function usernameToAuthEmail(input) {
  const raw = (input || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw.toLowerCase();
  const clean = raw.replace(/^@+/, "").toLowerCase();
  if (/^[a-z0-9_-]{3,40}$/.test(clean)) return clean + "@dzchat.com";
  let h1 = 2166136261, h2 = 5381;
  for (let i = 0; i < clean.length; i++) { const c = clean.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (((h2 << 5) + h2) ^ c) >>> 0; }
  return "u_" + h1.toString(36) + h2.toString(36) + "@dzchat.com";
}

async function ensureProfile(user) {
  const { data, error } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const username = cleanText((user.user_metadata?.username || user.user_metadata?.display_name || user.email.split("@")[0]).replace(/^@/, ""), 30);
  const { data: ins, error: iErr } = await db.from("profiles").upsert({ id: user.id, username, bio: "عضو في مجتمع DZ-CHAT", country: "الجزائر", avatar_url: null }, { onConflict: "id" }).select().single();
  if (iErr) throw iErr;
  return ins;
}

$("dzLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!checkRateLimit("auth", 1200)) return;
  const btn = e.submitter, raw = $("dzEmail").value.trim(), password = $("dzPassword").value;
  if (raw.replace(/^@+/, "").length < 3) { authMessage("اسم المستخدم يجب أن يكون 3 أحرف على الأقل", true); return; }
  btn.disabled = true; btn.textContent = "جارٍ الدخول...";
  try {
    const { data, error } = await db.auth.signInWithPassword({ email: usernameToAuthEmail(raw), password });
    if (error) throw error;
    await loadUser(data.user);
  } catch (err) {
    authMessage((err.message || "").includes("Invalid login credentials") ? "اسم المستخدم أو كلمة المرور غير صحيحة." : "تعذر تسجيل الدخول: " + err.message, true);
  } finally { btn.disabled = false; btn.textContent = "تسجيل الدخول"; }
});

$("dzRegisterForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!checkRateLimit("auth", 1200)) return;
  const username = cleanText($("dzName").value.replace(/^@+/, ""), 30), password = $("dzNewPassword").value, btn = e.submitter;
  if (username.length < 3) { authMessage("اسم المستخدم يجب أن يكون 3 أحرف على الأقل", true); return; }
  btn.disabled = true; btn.textContent = "جارٍ الإنشاء...";
  try {
    const { data, error } = await db.auth.signUp({ email: usernameToAuthEmail(username), password, options: { data: { username, display_name: username } } });
    if (error) throw error;
    if (data.session) await loadUser(data.user);
    else authMessage("أوقف Confirm email في Supabase للدخول المباشر.", true);
  } catch (err) {
    authMessage((err.message || "").includes("User already registered") ? "اسم المستخدم مستخدم بالفعل." : "تعذر إنشاء الحساب: " + err.message, true);
  } finally { btn.disabled = false; btn.textContent = "إنشاء حساب جديد"; }
});
async function refreshAllData(redrawFeed = true) {
  const [pRes, vRes, lRes, cRes, fRes, rRes, mRes] = await Promise.all([
    db.from("profiles").select("*"),
    db.from("videos").select("*").order("created_at", { ascending: false }),
    db.from("video_likes").select("video_id, user_id"),
    db.from("video_comments").select("id, video_id"),
    db.from("follows").select("follower_id, following_id"),
    db.from("live_rooms").select("*").eq("is_active", true).order("created_at", { ascending: false }),
    currentUser ? db.from("messages").select("*").order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] })
  ]);
  profilesMap = {}; (pRes.data || []).forEach(p => { profilesMap[p.id] = p; });
  if (currentUser && profilesMap[currentUser.id]) currentProfile = profilesMap[currentUser.id];
  videosCache = vRes.data || []; likesCache = lRes.data || []; commentsCache = cRes.data || [];
  followsCache = fRes.data || []; liveRoomsCache = rRes.data || []; allMessagesCache = mRes.data || [];
  if (!initialRoomsLoaded) { liveRoomsCache.forEach(r => knownLiveRoomIds.add(r.id)); initialRoomsLoaded = true; }
  renderLiveRoomsStrip(); renderProfile(); renderInbox();
  if (redrawFeed) { renderVideoFeed(); renderFriendsFeed(); } else videosCache.forEach(v => updatePostCountsInPlace(v.id));
  renderDiscoverSearch();
  if (!$("dzFollowsModal").hidden) renderFollowsList();
  if (!$("dzUserProfileModal").hidden && viewedUserProfileId) renderViewedUserProfile();
}

function setupOnlinePresence() {
  if (!currentUser) return;
  if (presenceChannel) db.removeChannel(presenceChannel);
  presenceChannel = db.channel("dz-online-presence", { config: { presence: { key: currentUser.id } } });
  presenceChannel.on("presence", { event: "sync" }, () => {
    const next = new Set();
    Object.values(presenceChannel.presenceState()).flat().forEach(p => { if (p && p.user_id && p.active !== false) next.add(p.user_id); });
    onlineUserIds = next;
    renderInbox();
    if (activeChatUserId !== "__none__" && activeChatUserId !== null) {
      const live = liveRoomsCache.find(r => r.host_id === activeChatUserId), f = profilesMap[activeChatUserId] || {};
      $("chatHeaderSub").textContent = live ? "🔴 في بث مباشر الآن" : (onlineUserIds.has(activeChatUserId) ? "🟢 نشط الآن" : (f.country || "غير متصل"));
    }
  }).subscribe(async s => { if (s === "SUBSCRIBED") await presenceChannel.track({ user_id: currentUser.id, active: showOnlineStatus }); });
}

async function loadUser(user) {
  if (!user) return;
  currentUser = user;
  try {
    currentProfile = await ensureProfile(user);
    showApp(); await refreshAllData(true); subscribeRealtimeAll(); setupOnlinePresence();
    showToast("مرحباً بك في DZ-CHAT 🇩🇿");
  } catch (err) { console.error(err); showApp(); showToast("خطأ في تحميل البيانات: " + err.message); }
}

function switchPage(pageId) {
  const target = $(pageId); if (!target) return;
  pages.forEach(p => p.classList.remove("active")); target.classList.add("active");
  app.className = "app page-" + pageId;
  navItems.forEach(i => i.classList.toggle("active", i.dataset.page === pageId));
  if (pageId !== "homePage" && pageId !== "discoverPage") document.querySelectorAll(".video-slide video").forEach(v => v.pause());
  if (pageId === "homePage") refreshAllData(false);
  if (pageId === "discoverPage") renderFriendsFeed();
  if (pageId === "messagesPage") refreshAllData(false);
  if (pageId === "profilePage") renderProfile();
}

async function unlockLiveAudioPool() {
  unlockNotifyAudio();
  if (livekitRoom) { try { await livekitRoom.startAudio(); } catch {} }
  let blocked = false;
  $("liveAudioPool").querySelectorAll("audio").forEach(a => {
    a.muted = false; a.volume = 1;
    if (a.paused) {
      const p = a.play();
      if (p && p.catch) p.catch(() => { blocked = true; liveAudioUnlockBtn.hidden = false; });
    }
  });
  if (!blocked && (!livekitRoom || livekitRoom.canPlaybackAudio)) liveAudioUnlockBtn.hidden = true;
}
liveAudioUnlockBtn.addEventListener("click", unlockLiveAudioPool);
if (liveRoomEl) {
  liveRoomEl.addEventListener("touchstart", unlockLiveAudioPool, { passive: true });
  liveRoomEl.addEventListener("click", unlockLiveAudioPool, { passive: true });
}

function renderLiveRoomsStrip() {
  const strip = $("liveRoomsStrip"); strip.textContent = "";
  const visibleRooms = liveRoomsCache.filter(r => !isUserBlocked(r.host_id) && !(currentUser && parseRoomMeta(r.title).bl.includes(currentUser.id)));
  if (!visibleRooms.length) { strip.hidden = true; return; }
  strip.hidden = false;
  visibleRooms.forEach(room => {
    const meta = parseRoomMeta(room.title), hostName = profilesMap[room.host_id]?.username || "مضيف";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "live-room-pill";
    btn.innerHTML = `<span class="live-pill-badge">${meta.p ? "🔒" : "🔴"} لايف</span><strong></strong><small></small>`;
    btn.querySelector("strong").textContent = meta.t; btn.querySelector("small").textContent = `(@${hostName})`;
    btn.addEventListener("click", () => tryEnterLiveRoom(room));
    strip.appendChild(btn);
  });
}

function applyLiveRoomBackground(bg) {
  const el = $("dzLiveRoom");
  const map = {
    default: "radial-gradient(circle at 50% 15%, #1d3557 0%, transparent 55%), linear-gradient(180deg, #0b1324 0%, #070b14 100%)",
    emerald: "radial-gradient(circle at 50% 15%, #065f46 0%, transparent 60%), linear-gradient(180deg, #064e3b 0%, #03110d 100%)",
    purple: "radial-gradient(circle at 50% 15%, #6d28d9 0%, transparent 60%), linear-gradient(180deg, #3b0764 0%, #0d051a 100%)",
    sunset: "radial-gradient(circle at 50% 15%, #c2410c 0%, transparent 60%), linear-gradient(180deg, #431407 0%, #110605 100%)",
    black: "linear-gradient(180deg, #000000 0%, #050505 100%)"
  };
  const safeBg = (bg && bg.startsWith("http")) ? safeCssBgUrl(bg) : "";
  el.style.backgroundImage = safeBg ? `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.75)), url("${safeBg}")` : (map[bg] || map.default);
}

function tryEnterLiveRoom(room) {
  if (!room || !currentUser) return;
  unlockNotifyAudio();
  const meta = parseRoomMeta(room.title);
  if (meta.bl && meta.bl.includes(currentUser.id) && room.host_id !== currentUser.id) {
    showToast("🚫 تم حظرك من دخول هذا البث المباشر");
    return;
  }
  if (meta.p && room.host_id !== currentUser.id) {
    pendingPinRoom = room; $("livePinAttemptInput").value = ""; $("livePinErr").hidden = true; $("dzLivePinModal").hidden = false; return;
  }
  enterLiveRoom(room);
}

$("dzCloseLivePin").addEventListener("click", () => { pendingPinRoom = null; $("dzLivePinModal").hidden = true; });
$("livePinSubmitBtn").addEventListener("click", () => {
  if (!pendingPinRoom) return;
  if ($("livePinAttemptInput").value.trim() === parseRoomMeta(pendingPinRoom.title).p) {
    const r = pendingPinRoom; pendingPinRoom = null; $("dzLivePinModal").hidden = true; enterLiveRoom(r);
  } else { $("livePinErr").textContent = "المفتاح السري غير صحيح!"; $("livePinErr").hidden = false; }
});

$("choiceUploadBtn").addEventListener("click", () => { $("dzCreateChoiceModal").hidden = true; switchPage("uploadPage"); });
$("choiceLiveBtn").addEventListener("click", () => { $("dzCreateChoiceModal").hidden = true; $("dzLiveSetupModal").hidden = false; });
$("dzCloseChoice").addEventListener("click", () => { $("dzCreateChoiceModal").hidden = true; });
$("dzCreateChoiceModal").addEventListener("click", e => { if (e.target === $("dzCreateChoiceModal")) $("dzCreateChoiceModal").hidden = true; });
$("dzCloseLiveSetup").addEventListener("click", () => { $("dzLiveSetupModal").hidden = true; });
$("dzLiveSetupModal").addEventListener("click", e => { if (e.target === $("dzLiveSetupModal")) $("dzLiveSetupModal").hidden = true; });

$("liveModeVideo").addEventListener("click", () => { selectedLiveMode = "video"; $("liveModeVideo").classList.add("active"); $("liveModeAudio").classList.remove("active"); });
$("liveModeAudio").addEventListener("click", () => { selectedLiveMode = "audio"; $("liveModeAudio").classList.add("active"); $("liveModeVideo").classList.remove("active"); });

$("startLiveConfirmBtn").addEventListener("click", async () => {
  if (!currentUser || !checkRateLimit("startLive", 1500)) return;
  unlockNotifyAudio();
  const btn = $("startLiveConfirmBtn"), titleText = cleanText($("liveTitleInput").value, 80) || "غرفة لايف 🇩🇿";
  const packed = packRoomMeta({ t: titleText, m: selectedLiveMode, b: "default", p: "", s: "", bl: [], hc: false });
  btn.disabled = true; btn.textContent = "جارٍ فتح البث...";
  try {
    await db.from("live_rooms").update({ is_active: false }).eq("host_id", currentUser.id);
    const { data, error } = await db.from("live_rooms").insert({ host_id: currentUser.id, title: packed, is_active: true }).select().single();
    if (error) throw error;
    knownLiveRoomIds.add(data.id);
    $("dzLiveSetupModal").hidden = true;
    await refreshAllData(false);
    await enterLiveRoom(data);
  } catch (err) { alert("تعذر فتح البث:\n" + (err.message || err)); }
  finally { btn.disabled = false; btn.textContent = "بدء البث المباشر الآن"; }
});

const LIVE_GIFTS = [
  { id: "rose",           name: "وردة حمراء",     emoji: "🌹", points: 2,    type: "image", src: "./gifts/rose.png" },
  { id: "heart",          name: "قلب ذهبي",       emoji: "💛", points: 10,   type: "image", src: "./gifts/heart.png" },
  { id: "coffee",         name: "قهوة فاخرة",     emoji: "☕", points: 15,   type: "image", src: "./gifts/coffee.png" },
  { id: "diamond",        name: "ماسة زرقاء",     emoji: "💎", points: 20,   type: "image", src: "./gifts/diamond.png" },
  { id: "bear",           name: "دب",             emoji: "🧸", points: 30,   type: "video", src: "./gifts/bear.mp4",           thumb: "./gifts/bear.png",           dur: 8500 },
  { id: "crown",          name: "تاج ملكي",       emoji: "👑", points: 50,   type: "image", src: "./gifts/crown.png" },
  { id: "sheep",          name: "الخروف",         emoji: "🐑", points: 50,   type: "video", src: "./gifts/sheep.mp4",          thumb: "./gifts/sheep.png",          dur: 8500 },
  { id: "gold_box",       name: "صندوق ذهب",      emoji: "💰", points: 100,  type: "video", src: "./gifts/gold_box.mp4",       thumb: "./gifts/gold_box.png",       dur: 8500 },
  { id: "skeleton",       name: "هيكل عظمي",      emoji: "💀", points: 150,  type: "video", src: "./gifts/skeleton.mp4",       thumb: "./gifts/skeleton.png",       dur: 8500 },
  { id: "lion",           name: "أسد ناري",       emoji: "🦁", points: 200,  type: "video", src: "./gifts/lion.mp4",           thumb: "./gifts/lion.png",           dur: 5500 },
  { id: "gold_ring",      name: "خاتم ذهبي",      emoji: "💍", points: 200,  type: "video", src: "./gifts/gold_ring.mp4",      thumb: "./gifts/gold_ring.png",      dur: 8500 },
  { id: "birthday",       name: "هدية عيد ميلاد", emoji: "🎂", points: 200,  type: "video", src: "./gifts/birthday.mp4",       thumb: "./gifts/birthday.png",       dur: 8500 },
  { id: "elephant",       name: "الفيل الهندي",   emoji: "🐘", points: 300,  type: "video", src: "./gifts/elephant.mp4",       thumb: "./gifts/elephant.png",       dur: 8500 },
  { id: "car",            name: "سيارة فاخرة",    emoji: "🏎️", points: 500,  type: "video", src: "./gifts/car.mp4",            thumb: "./gifts/car.png",            dur: 9500 },
  { id: "grey_wolf",      name: "ذئب رمادي",      emoji: "🐺", points: 600,  type: "video", src: "./gifts/grey_wolf.mp4",      thumb: "./gifts/grey_wolf.png",      dur: 8500 },
  { id: "red_eagle",      name: "نسر أحمر ملكي",  emoji: "🦅", points: 700,  type: "video", src: "./gifts/red_eagle.mp4",      thumb: "./gifts/red_eagle.png",      dur: 8500 },
  { id: "camel",          name: "الجمل",          emoji: "🐪", points: 850,  type: "video", src: "./gifts/camel.mp4",          thumb: "./gifts/camel.png",          dur: 8500 },
  { id: "blue_tiger",     name: "النمر الأزرق",   emoji: "🐯", points: 1000, type: "video", src: "./gifts/blue_tiger.mp4",     thumb: "./gifts/blue_tiger.png",     dur: 8500 },
  { id: "black_dragon",   name: "التنين الأسود",  emoji: "🐲", points: 1400, type: "video", src: "./gifts/black_dragon.mp4",   thumb: "./gifts/black_dragon.png",   dur: 8500 },
  { id: "gold_lion",      name: "الأسد الذهبي",   emoji: "🦁", points: 1500, type: "video", src: "./gifts/gold_lion.mp4",      thumb: "./gifts/gold_lion.png",      dur: 8500 },
  { id: "dark_coast",     name: "ساحل الظلام",    emoji: "🌑", points: 1500, type: "video", src: "./gifts/dark_coast.mp4",     thumb: "./gifts/dark_coast.png",     dur: 8500 },
  { id: "princess",       name: "الأميرة البيضاء",emoji: "👸", points: 1700, type: "video", src: "./gifts/princess.mp4",       thumb: "./gifts/princess.png",       dur: 8500 },
  { id: "white_dragon",   name: "التنين الأبيض",  emoji: "🐉", points: 1800, type: "video", src: "./gifts/white_dragon.mp4",   thumb: "./gifts/white_dragon.png",   dur: 8500 },
  { id: "destroyer_lion", name: "الأسد المدمر",   emoji: "🔥", points: 1800, type: "video", src: "./gifts/destroyer_lion.mp4", thumb: "./gifts/destroyer_lion.png", dur: 8500 },
  { id: "ship",           name: "الباخرة",        emoji: "🚢", points: 2000, type: "video", src: "./gifts/ship.mp4",           thumb: "./gifts/ship.png",           dur: 8500 },
  { id: "king",           name: "الملك",          emoji: "🤴", points: 2000, type: "video", src: "./gifts/king.mp4",           thumb: "./gifts/king.png",           dur: 8500 },
  { id: "plane",          name: "الطائرة",        emoji: "✈️", points: 3000, type: "video", src: "./gifts/plane.mp4",          thumb: "./gifts/plane.png",          dur: 8500 },
  { id: "travel_plane",   name: "طائرة سفر",      emoji: "🛫", points: 5000, type: "video", src: "./gifts/travel_plane.mp4",   thumb: "./gifts/travel_plane.png",   dur: 8500 }
];
let liveGiftPointsMap = {}, liveSupportersMap = {}, liveRecipientDonorsMap = {};
let liveViewerIds = [], liveShareCount = 0, liveLikesCount = 0, liveViewersCount = 1;
let liveGiftQueue = [], isPlayingGiftAnim = false, giftAnimTimeout = null;
let selectedGiftId = "rose", selectedGiftTargetId = null, activeLiveCardUserId = null, activeContribGuestId = null;

function updateLivePointsBadges() {
  if (!activeLiveRoom) return;
  document.querySelectorAll("[data-points-uid]").forEach(el => {
    const uid = el.dataset.pointsUid;
    el.textContent = String(Number(liveGiftPointsMap[uid]) || 0);
  });
}

function renderTopSupporters() {
  const box = $("liveTopSupporters");
  if (!box) return;
  box.textContent = "";
  const ranked = Object.entries(liveSupportersMap).filter(([, pts]) => pts > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  ranked.forEach(([uid]) => {
    const p = profilesMap[uid] || {};
    const av = document.createElement("div"); av.className = "live-sup-av";
    av.title = "@" + (p.username || "داعم");
    setAvatarContent(av, p.avatar_url, p.username || "داعم");
    box.appendChild(av);
  });
}

function applyCommentsVisibilityUI() {
  if (!activeLiveRoom) return;
  const meta = parseRoomMeta(activeLiveRoom.title);
  const hidden = !!meta.hc;
  if ($("liveCommentsArea")) $("liveCommentsArea").hidden = hidden;
  if ($("liveCommentsHiddenNote")) $("liveCommentsHiddenNote").hidden = !hidden;
  if ($("liveToggleHideCommentsBtn")) {
    $("liveToggleHideCommentsBtn").textContent = hidden ? "👁️ إظهار التعليقات" : "🙈 إخفاء التعليقات";
  }
}

function updateLiveTopStatsUI() {
  if (!activeLiveRoom) return;
  const seatedCount = liveSeatsCache.filter(s => s.status === "seated").length;
  if ($("liveGoalText")) $("liveGoalText").textContent = `${seatedCount}/8`;
  if ($("liveLikesCount")) $("liveLikesCount").textContent = formatCount(liveLikesCount);
  if ($("liveShareCountBadge")) $("liveShareCountBadge").textContent = String(liveShareCount);
  if ($("liveViewersCount")) $("liveViewersCount").textContent = String(Math.max(1, liveViewersCount));
  renderTopSupporters();
  const hostId = activeLiveRoom.host_id;
  const isHost = currentUser && hostId === currentUser.id;
  const joinBtn = $("liveHostJoinBtn");
  if (joinBtn) {
    joinBtn.hidden = isHost;
    const isFollowing = currentUser && followsCache.some(f => f.follower_id === currentUser.id && f.following_id === hostId);
    joinBtn.classList.toggle("joined", !!isFollowing);
    joinBtn.textContent = isFollowing ? "متابع ✓" : "انضمام 🧡";
  }
}

async function enterLiveRoom(room) {
  if (!currentUser || !room) return;
  const meta = parseRoomMeta(room.title);
  if (meta.bl && meta.bl.includes(currentUser.id) && room.host_id !== currentUser.id) {
    showToast("🚫 أنت محظور من دخول هذا البث");
    return;
  }
  activeLiveRoom = room;
  seatDecorMap = {}; mySeatDecorUrl = "";
  liveGiftPointsMap = { [room.host_id]: 0 };
  liveSupportersMap = {}; liveRecipientDonorsMap = {};
  liveViewerIds = [currentUser.id];
  liveShareCount = 0; liveLikesCount = 0; liveViewersCount = 1;
  liveGiftQueue = []; isPlayingGiftAnim = false;
  selectedGiftId = "rose"; selectedGiftTargetId = room.host_id;
  $("liveGiftOverlay").hidden = true;

  const host = profilesMap[room.host_id] || {}, isHost = room.host_id === currentUser.id;
  isMicMuted = false; isCamEnabled = isHost && meta.m === "video"; currentCamFacing = "user";
  liveAudioUnlockBtn.hidden = true;
  document.querySelectorAll(".video-slide video").forEach(v => v.pause());
  $("liveRoomTitle").textContent = (meta.p ? "🔒 " : "") + meta.t;
  $("liveHostName").textContent = "@" + (host.username || "host");
  setAvatarContent($("liveHostAvatar"), host.avatar_url, "المضيف");
  $("liveSettingsBtn").hidden = !isHost;
  $("liveRequestsDrawer").hidden = true;
  applyLiveRoomBackground(meta.b);
  applyCommentsVisibilityUI();
  $("dzLiveRoom").hidden = false;

  updateLiveTopStatsUI();
  await loadLiveRoomState();
  await setupLiveRoomRealtime(room.id);
  const myName = currentProfile?.username || "عضو";
  db.from("live_comments").insert({ room_id: room.id, user_id: currentUser.id, content: `👋 دخل @${myName} إلى البث` }).then(() => {});
}

async function loadLiveRoomState() {
  if (!activeLiveRoom) return;
  const [sRes, cRes] = await Promise.all([
    db.from("live_seats").select("*").eq("room_id", activeLiveRoom.id).order("created_at", { ascending: true }),
    db.from("live_comments").select("*").eq("room_id", activeLiveRoom.id).order("created_at", { ascending: true }).limit(80)
  ]);
  liveSeatsCache = sRes.data || []; liveCommentsCache = cRes.data || [];
  renderLiveSeatsAndControls(); renderLiveComments(); updateLiveTopStatsUI();
  await syncSpeakerMediaAndPresence();
}

function getStreamForUser(uid) {
  if (!uid || !currentUser) return null;
  if (uid === currentUser.id) return localMediaStream;
  return remoteMediaStreams[uid] || null;
}

function renderSpotlightStage() {
  const stage = $("liveHostStage");
  if (!activeLiveRoom || !currentUser) { stage.hidden = true; stage.textContent = ""; return; }
  const hostId = activeLiveRoom.host_id;
  const isMe = hostId === currentUser.id;
  const p = profilesMap[hostId] || {};
  const stream = getStreamForUser(hostId);
  const hasVid = stream && stream.getVideoTracks().some(t => t.readyState === "live") && (!isMe || isCamEnabled);
  const decor = safeUrl(seatDecorMap[hostId], false);

  stage.hidden = false; stage.textContent = "";
  const card = document.createElement("div"); card.className = "spotlight-card";
  if (hasVid) {
    const v = document.createElement("video"); v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = stream;
    card.appendChild(v); v.play().catch(() => {});
  } else if (decor) {
    const bg = document.createElement("img"); bg.className = "spotlight-bg-img"; bg.src = decor; card.appendChild(bg);
  } else {
    const av = document.createElement("div"); av.className = "spotlight-av"; setAvatarContent(av, p.avatar_url, p.username);
    card.appendChild(av);
  }

  const pts = document.createElement("button"); pts.type = "button"; pts.className = "seat-points-badge";
  const pNum = document.createElement("span"); pNum.dataset.pointsUid = hostId; pNum.textContent = String(Number(liveGiftPointsMap[hostId]) || 0);
  const pStar = document.createElement("span"); pStar.className = "star-ico"; pStar.textContent = "★";
  pts.append(pNum, pStar);
  pts.onclick = e => { e.stopPropagation(); openGuestContributorsModal(hostId); };
  card.appendChild(pts);

  const mic = document.createElement("button"); mic.type = "button";
  mic.className = "host-stage-mic-badge" + (isMe && isMicMuted ? " muted" : "");
  mic.textContent = (isMe && isMicMuted) ? "🔇" : "🎙️";
  if (isMe) mic.onclick = e => { e.stopPropagation(); toggleMyLiveMic(); };
  card.appendChild(mic);

  const nmWrap = document.createElement("div"); nmWrap.className = "host-stage-name-pill";
  const nm = document.createElement("span"); nm.textContent = `👑 المضيف • @${p.username || "host"}`;
  nmWrap.appendChild(nm); card.appendChild(nmWrap);

  stage.onclick = () => openSeatOptionsModal(hostId, 1);
  stage.appendChild(card);
}

function openSeatOptionsModal(userId, seatNum) {
  if (!activeLiveRoom || !currentUser) return;
  const isHost = activeLiveRoom.host_id === currentUser.id;
  const isMe = userId === currentUser.id;
  const p = profilesMap[userId] || {};
  $("seatActionTitle").textContent = (seatNum === 1 ? "👑 صاحب البث" : `مقعد ${seatNum}`) + " • @" + (p.username || "عضو");
  const box = $("seatActionButtons"); box.textContent = "";

  const addBtn = (label, cls, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label;
    if (cls) b.className = cls;
    b.onclick = () => { $("dzSeatActionModal").hidden = true; fn(); };
    box.appendChild(b);
  };

  if (!isMe) addBtn("🎁 إرسال هدية إلى @" + (p.username || "عضو"), "choice-live-btn", () => openLiveGiftsModal(userId));
  addBtn("★ عرض نقاط ومساهمي @" + (p.username || "عضو"), "modal-cancel-btn", () => openGuestContributorsModal(userId));
  if (isMe) {
    addBtn(isMicMuted ? "🎙️ فتح المايك" : "🔇 غلق المايك", isMicMuted ? "" : "modal-cancel-btn", toggleMyLiveMic);
    addBtn(isCamEnabled ? "📷 غلق الكاميرا" : "📹 فتح الكاميرا", "", toggleSeatCamera);
    addBtn("🔄 تبديل الكاميرا (أمامية / خلفية)", "", flipSeatCamera);
    addBtn("🖼️ وضع صورة تزيين في المقعد", "", () => seatPhotoInput.click());
    if (mySeatDecorUrl) addBtn("🗑️ إزالة صورة تزيين المقعد", "modal-cancel-btn", clearMySeatDecor);
  }
  if (!isMe) addBtn("👤 عرض البطاقة / الملف", "modal-cancel-btn", () => openLiveUserCard(userId));
  if (isHost && !isMe) addBtn("⬇️ إنزال الضيف من المقعد", "choice-live-btn", () => removeSeatRow(userId));
  $("dzSeatActionModal").hidden = false;
}
$("dzCloseSeatAction").addEventListener("click", () => { $("dzSeatActionModal").hidden = true; });
$("dzSeatActionModal").addEventListener("click", e => { if (e.target === $("dzSeatActionModal")) $("dzSeatActionModal").hidden = true; });

async function clearMySeatDecor() {
  mySeatDecorUrl = "";
  if (currentUser) delete seatDecorMap[currentUser.id];
  if (liveRoomChannel && currentUser) {
    await liveRoomChannel.track({ user_id: currentUser.id, is_speaker: amISpeakerNow, decor: "", points_map: liveGiftPointsMap, supporters_map: liveSupportersMap, donors_map: liveRecipientDonorsMap });
  }
  renderLiveSeatsAndControls();
  showToast("تمت إزالة صورة المقعد");
}

function renderLiveSeatsAndControls() {
  if (!activeLiveRoom || !currentUser) return;
  const isHost = activeLiveRoom.host_id === currentUser.id, mySeat = liveSeatsCache.find(s => s.user_id === currentUser.id);
  const pending = liveSeatsCache.filter(s => s.status === "pending");
  const seated = liveSeatsCache.filter(s => s.status === "seated").slice(0, 8);

  $("liveReqToggleBtn").hidden = !isHost;
  $("liveReqCount").textContent = pending.length;
  if ($("liveReqCountBadge")) {
    $("liveReqCountBadge").hidden = !isHost || pending.length === 0;
    $("liveReqCountBadge").textContent = String(pending.length);
  }

  const reqList = $("liveRequestsList"); reqList.textContent = "";
  if (!pending.length) reqList.innerHTML = `<div style="font-size:11px;color:#94a3b8;text-align:center;padding:6px">لا توجد طلبات صعود حالياً</div>`;
  else pending.forEach(req => {
    const u = profilesMap[req.user_id] || {}, row = document.createElement("div"); row.className = "req-row";
    const nm = document.createElement("span"); nm.textContent = "@" + (u.username || "صديق") + " يطلب الصعود";
    const btns = document.createElement("div"); btns.className = "req-btns";
    const acc = document.createElement("button"); acc.type = "button"; acc.className = "req-accept"; acc.textContent = "قبول ✅"; acc.onclick = () => approveGuestRequest(req.user_id);
    const rej = document.createElement("button"); rej.type = "button"; rej.className = "req-reject"; rej.textContent = "رفض"; rej.onclick = () => removeSeatRow(req.user_id);
    btns.append(acc, rej); row.append(nm, btns); reqList.appendChild(row);
  });

  const wrap = $("liveStageGridWrap"), grid = $("liveGuestSeats");
  const totalOnStage = Math.min(9, 1 + seated.length);
  wrap.dataset.total = String(totalOnStage);
  grid.hidden = seated.length === 0;
  grid.textContent = "";

  renderSpotlightStage();
  updateLiveTopStatsUI();

  seated.forEach(guest => {
    const userId = guest.user_id, prof = profilesMap[userId] || {}, isMe = userId === currentUser.id;
    const seatEl = document.createElement("div");
    seatEl.className = "guest-seat occupied";
    const decor = safeUrl(seatDecorMap[userId], false);
    if (decor) {
      seatEl.classList.add("has-decor");
      const dImg = document.createElement("img"); dImg.className = "seat-decor-img"; dImg.src = decor; seatEl.appendChild(dImg);
    }

    const pts = document.createElement("button"); pts.type = "button"; pts.className = "seat-points-badge";
    const pNum = document.createElement("span"); pNum.dataset.pointsUid = userId; pNum.textContent = String(Number(liveGiftPointsMap[userId]) || 0);
    const pStar = document.createElement("span"); pStar.className = "star-ico"; pStar.textContent = "★";
    pts.append(pNum, pStar);
    pts.onclick = e => { e.stopPropagation(); openGuestContributorsModal(userId); };
    seatEl.appendChild(pts);

    const muted = isMe ? isMicMuted : !!guest.is_muted;
    const micBtn = document.createElement("button"); micBtn.type = "button";
    micBtn.className = "seat-mic-btn " + (muted ? "muted" : "unmuted");
    micBtn.textContent = muted ? "🔇" : "🎙️";
    if (isMe) micBtn.onclick = e => { e.stopPropagation(); toggleMyLiveMic(); };
    else micBtn.onclick = e => { e.stopPropagation(); };
    seatEl.appendChild(micBtn);

    const av = document.createElement("div"); av.className = "seat-avatar";
    const stream = getStreamForUser(userId);
    const hasVid = stream && stream.getVideoTracks().some(t => t.readyState === "live") && (!isMe || isCamEnabled);
    if (hasVid) {
      seatEl.classList.add("has-video");
      const v = document.createElement("video"); v.className = "seat-video-fill"; v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = stream;
      seatEl.appendChild(v); v.play().catch(() => {});
    } else setAvatarContent(av, prof.avatar_url, prof.username || "ضيف");

    const lb = document.createElement("div"); lb.className = "seat-name"; lb.textContent = "@" + (prof.username || "ضيف");
    seatEl.append(av, lb);
    seatEl.onclick = () => openSeatOptionsModal(userId, guest.seat_number || 2);
    grid.appendChild(seatEl);
  });

  const ctrl = $("liveActionControls"); ctrl.textContent = "";
  if (!isHost && mySeat?.status === "seated") {
    const b = document.createElement("button"); b.type = "button"; b.className = "live-ctrl-btn warn"; b.textContent = "⬇️ نزول من المقعد"; b.onclick = () => removeSeatRow(currentUser.id); ctrl.appendChild(b);
  } else if (!isHost && mySeat?.status === "pending") {
    const b = document.createElement("button"); b.type = "button"; b.className = "live-ctrl-btn warn"; b.textContent = "⏳ إلغاء طلب الصعود"; b.onclick = () => removeSeatRow(currentUser.id); ctrl.appendChild(b);
  }
}
function refreshGiftSwitchHeader() {
  if (!activeLiveRoom) return;
  const hostId = activeLiveRoom.host_id;
  const tp = profilesMap[selectedGiftTargetId] || {};
  setAvatarContent($("liveGiftRecAv"), tp.avatar_url, tp.username);
  $("liveGiftRecName").textContent = (selectedGiftTargetId === hostId ? "👑 " : "") + "@" + (tp.username || "المضيف");
  const myPts = liveSupportersMap[currentUser?.id] || 0;
  const lvl = Math.min(50, Math.floor(myPts / 100) + 1);
  if ($("liveGiftSenderLvl")) $("liveGiftSenderLvl").textContent = String(lvl);
  if ($("liveGiftProgressFill")) $("liveGiftProgressFill").style.width = Math.min(100, (myPts % 100) || 18) + "%";
  if ($("liveGiftSupText")) $("liveGiftSupText").textContent = `نقاط دعمك: ${myPts} ✨`;
}

function openLiveGiftsModal(preselectedUserId = null) {
  if (!activeLiveRoom || !currentUser) return;
  const hostId = activeLiveRoom.host_id;
  const seatedIds = liveSeatsCache.filter(s => s.status === "seated").map(s => s.user_id);
  const candidates = [hostId, ...seatedIds.filter(id => id !== hostId)];
  if (preselectedUserId && candidates.includes(preselectedUserId)) selectedGiftTargetId = preselectedUserId;
  else if (!selectedGiftTargetId || !candidates.includes(selectedGiftTargetId)) selectedGiftTargetId = hostId;

  const tRow = $("liveGiftTargetsRow"); tRow.textContent = ""; tRow.hidden = true;
  candidates.forEach(uid => {
    const p = profilesMap[uid] || {};
    const chip = document.createElement("button"); chip.type = "button";
    chip.className = "gift-target-chip" + (selectedGiftTargetId === uid ? " active" : "");
    const av = document.createElement("div"); av.className = "tav"; setAvatarContent(av, p.avatar_url, p.username);
    const sp = document.createElement("span");
    sp.textContent = (uid === hostId ? "👑 " : "") + "@" + (p.username || "عضو");
    chip.append(av, sp);
    chip.onclick = () => {
      selectedGiftTargetId = uid;
      tRow.querySelectorAll(".gift-target-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      refreshGiftSwitchHeader();
      tRow.hidden = true;
    };
    tRow.appendChild(chip);
  });

  refreshGiftSwitchHeader();
  renderGiftGridTiles();
  $("dzLiveGiftsModal").hidden = false;
}

function renderGiftGridTiles() {
  const grid = $("liveGiftsGrid"); grid.textContent = "";
  LIVE_GIFTS.forEach(g => {
    const isSel = selectedGiftId === g.id;
    const tile = document.createElement("div");
    tile.className = "gift-tile-pro" + (isSel ? " selected" : "");
    if (g.type === "video") {
      const vt = document.createElement("span"); vt.className = "gift-tile-vid-tag"; vt.textContent = "🎬"; tile.appendChild(vt);
    }
    const media = document.createElement("div"); media.className = "gift-tile-media";
    const imgSrc = safeUrl(g.thumb || g.src, false);
    if (imgSrc && imgSrc.endsWith(".png")) {
      const img = document.createElement("img"); img.src = imgSrc; img.alt = g.name;
      img.onerror = () => { img.remove(); media.textContent = g.emoji; };
      media.appendChild(img);
    } else media.textContent = g.emoji;
    tile.appendChild(media);

    if (isSel) {
      const pts = document.createElement("div"); pts.className = "gift-tile-pts"; pts.textContent = `${g.points} 🪙`;
      const sBtn = document.createElement("button"); sBtn.type = "button"; sBtn.className = "gift-tile-send-btn"; sBtn.textContent = "إرسال";
      sBtn.onclick = e => {
        e.stopPropagation();
        sendLiveGift(g.id, selectedGiftTargetId);
        $("dzLiveGiftsModal").hidden = true;
      };
      tile.append(pts, sBtn);
    } else {
      const nm = document.createElement("div"); nm.className = "gift-tile-name"; nm.textContent = g.name;
      const pts = document.createElement("div"); pts.className = "gift-tile-pts"; pts.textContent = `${g.points} 🪙`;
      tile.append(nm, pts);
    }
    tile.onclick = () => { selectedGiftId = g.id; renderGiftGridTiles(); };
    grid.appendChild(tile);
  });
}

$("liveGiftSwitchBtn").addEventListener("click", () => {
  const row = $("liveGiftTargetsRow");
  if (row) row.hidden = !row.hidden;
});
$("liveGiftsBtn").addEventListener("click", () => openLiveGiftsModal());
$("dzCloseLiveGifts").addEventListener("click", () => { $("dzLiveGiftsModal").hidden = true; });
$("dzLiveGiftsModal").addEventListener("click", e => { if (e.target === $("dzLiveGiftsModal")) $("dzLiveGiftsModal").hidden = true; });

async function sendLiveGift(giftId, targetUserId) {
  if (!activeLiveRoom || !currentUser || !checkRateLimit("gift", 350)) return;
  const gift = LIVE_GIFTS.find(g => g.id === giftId); if (!gift) return;
  const hostId = activeLiveRoom.host_id;
  const validIds = new Set([hostId, ...liveSeatsCache.filter(s => s.status === "seated").map(s => s.user_id)]);
  const recId = validIds.has(targetUserId) ? targetUserId : hostId;

  const newTotal = (liveGiftPointsMap[recId] || 0) + gift.points;
  liveGiftPointsMap[recId] = newTotal;
  liveSupportersMap[currentUser.id] = (liveSupportersMap[currentUser.id] || 0) + gift.points;
  if (!liveRecipientDonorsMap[recId]) liveRecipientDonorsMap[recId] = {};
  liveRecipientDonorsMap[recId][currentUser.id] = (liveRecipientDonorsMap[recId][currentUser.id] || 0) + gift.points;

  updateLivePointsBadges();
  renderTopSupporters();

  const payload = {
    giftId: gift.id, giftName: gift.name, giftEmoji: gift.emoji, points: gift.points,
    totalPoints: newTotal, senderTotal: liveSupportersMap[currentUser.id],
    senderToRecTotal: liveRecipientDonorsMap[recId][currentUser.id],
    senderId: currentUser.id, senderName: currentProfile?.username || "عضو",
    senderAvatar: currentProfile?.avatar_url || "",
    recipientId: recId, recipientName: profilesMap[recId]?.username || "المضيف"
  };

  if (liveRoomChannel) {
    liveRoomChannel.send({ type: "broadcast", event: "live-gift", payload });
    liveRoomChannel.track({
      user_id: currentUser.id, is_speaker: amISpeakerNow, decor: mySeatDecorUrl,
      points_map: liveGiftPointsMap, supporters_map: liveSupportersMap, donors_map: liveRecipientDonorsMap
    }).catch(() => {});
  }
  enqueueLiveGiftAnimation(payload);
}

function enqueueLiveGiftAnimation(payload) {
  liveGiftQueue.push(payload);
  if (!isPlayingGiftAnim) playNextGiftInQueue();
}

function spawnGiftParticles(emoji) {
  const layer = $("liveGiftParticles"); layer.textContent = "";
  const items = [emoji, "💛", "✨", "❤️", "🌸", emoji, "✨", "💛"];
  items.forEach((sym, i) => {
    const sp = document.createElement("span"); sp.className = "gift-particle";
    sp.textContent = sym;
    sp.style.left = (10 + (i * 11) % 82) + "%";
    sp.style.bottom = (18 + (i % 3) * 14) + "%";
    sp.style.animationDelay = (i * 0.16) + "s";
    layer.appendChild(sp);
  });
}

function playNextGiftInQueue() {
  if (!liveGiftQueue.length || !activeLiveRoom) {
    isPlayingGiftAnim = false;
    $("liveGiftOverlay").hidden = true;
    const v = $("liveGiftVideo"); if (v) { v.pause(); v.removeAttribute("src"); }
    return;
  }
  isPlayingGiftAnim = true;
  clearTimeout(giftAnimTimeout);
  const p = liveGiftQueue.shift();
  const gift = LIVE_GIFTS.find(g => g.id === p.giftId) || LIVE_GIFTS[0];

  setAvatarContent($("liveGiftSenderAv"), p.senderAvatar, p.senderName);
  $("liveGiftBannerTitle").textContent = `${p.senderName || "عضو"} أرسل لك ${gift.name}`;
  $("liveGiftBannerSub").textContent = `+${gift.points} نقطة إلى @${p.recipientName || "المضيف"} • شكراً على الهدية ❤️`;
  $("liveGiftBannerIco").textContent = gift.emoji;
  spawnGiftParticles(gift.emoji);

  const vWrap = $("liveGiftVideoWrap"), iWrap = $("liveGiftImageWrap"), vid = $("liveGiftVideo"), img = $("liveGiftImg"), fb = $("liveGiftFallbackArt");
  $("liveGiftOverlay").hidden = false;

  const finishStep = () => {
    clearTimeout(giftAnimTimeout);
    vid.onended = null; vid.onerror = null;
    try { vid.pause(); } catch {}
    playNextGiftInQueue();
  };

  const showImageMode = (durationMs = 3600) => {
    vWrap.hidden = true; iWrap.hidden = false;
    fb.textContent = gift.emoji; fb.hidden = false; img.hidden = true;
    const imgSrc = safeUrl(gift.thumb || gift.src, false);
    if ((gift.type === "image" || imgSrc.endsWith(".png")) && imgSrc) {
      img.onload = () => { img.hidden = false; fb.hidden = true; };
      img.onerror = () => { img.hidden = true; fb.hidden = false; };
      img.src = imgSrc;
    }
    giftAnimTimeout = setTimeout(finishStep, durationMs);
  };

  const vidSrc = safeUrl(gift.src, false);
  if (gift.type === "video" && vidSrc) {
    iWrap.hidden = true; vWrap.hidden = false;
    vid.muted = false; vid.src = vidSrc; vid.currentTime = 0;
    vid.onended = finishStep;
    vid.onerror = () => { showImageMode(3800); };
    vid.play().catch(() => {
      vid.muted = true;
      vid.play().catch(() => showImageMode(3800));
    });
    giftAnimTimeout = setTimeout(finishStep, (gift.dur || 8500) + 1200);
  } else {
    showImageMode(3600);
  }
}

function openLiveViewersModal() {
  if (!activeLiveRoom) return;
  const hostId = activeLiveRoom.host_id;
  const seatedSet = new Set(liveSeatsCache.filter(s => s.status === "seated").map(s => s.user_id));
  const ids = [...new Set([hostId, ...seatedSet, ...liveViewerIds, currentUser?.id].filter(Boolean))];
  $("liveViewersModalCount").textContent = String(Math.max(ids.length, liveViewersCount));
  const list = $("liveViewersModalList"); list.textContent = "";
  ids.sort((a, b) => {
    if (a === hostId) return -1; if (b === hostId) return 1;
    return (liveSupportersMap[b] || 0) - (liveSupportersMap[a] || 0);
  });
  ids.forEach(uid => {
    const p = profilesMap[uid] || {};
    const row = document.createElement("div"); row.className = "viewer-row";
    const right = document.createElement("div"); right.className = "viewer-row-r";
    const av = document.createElement("div"); av.className = "viewer-row-av"; setAvatarContent(av, p.avatar_url, p.username);
    const txt = document.createElement("div"); txt.className = "viewer-row-txt";
    const st = document.createElement("strong"); st.textContent = "@" + (p.username || "عضو");
    const sm = document.createElement("small"); sm.textContent = (liveSupportersMap[uid] || 0) > 0 ? `دعم بـ ${liveSupportersMap[uid]} نقطة 🎁` : (p.country || "DZ-CHAT");
    txt.append(st, sm); right.append(av, txt);

    const role = document.createElement("span");
    const isH = uid === hostId, isG = seatedSet.has(uid);
    role.className = "viewer-role-tag" + (isH ? " host" : (isG ? " guest" : ""));
    role.textContent = isH ? "المضيف 👑" : (isG ? "ضيف 🎙️" : "مشاهد");
    row.append(right, role);
    row.onclick = () => { $("dzLiveViewersModal").hidden = true; openLiveUserCard(uid); };
    list.appendChild(row);
  });
  $("dzLiveViewersModal").hidden = false;
}
$("liveViewersCount").addEventListener("click", openLiveViewersModal);
$("liveTopSupporters").addEventListener("click", openLiveViewersModal);
$("dzCloseLiveViewers").addEventListener("click", () => { $("dzLiveViewersModal").hidden = true; });
$("dzLiveViewersModal").addEventListener("click", e => { if (e.target === $("dzLiveViewersModal")) $("dzLiveViewersModal").hidden = true; });

function openGuestContributorsModal(guestId) {
  if (!activeLiveRoom || !guestId) return;
  activeContribGuestId = guestId;
  const gp = profilesMap[guestId] || {};
  $("contribGuestTitle").textContent = "نقاط " + (gp.username || "الضيف");
  $("contribGuestTotal").textContent = String(Number(liveGiftPointsMap[guestId]) || 0);
  setAvatarContent($("contribGuestAv"), gp.avatar_url, gp.username);

  const donors = liveRecipientDonorsMap[guestId] || {};
  const ranked = Object.entries(donors).filter(([, pts]) => pts > 0).sort((a, b) => b[1] - a[1]);
  const list = $("contribList"); list.textContent = "";
  if (!ranked.length) {
    list.innerHTML = `<p style="text-align:center;color:#94a3b8;font-size:12px;padding:28px 0;">لا يوجد مساهمون لهذا المقعد بعد. كن أول من يرسل هدية! 🎁</p>`;
  } else {
    ranked.forEach(([uid, pts], idx) => {
      const up = profilesMap[uid] || {};
      const row = document.createElement("div"); row.className = "contrib-row";
      const rBox = document.createElement("div"); rBox.className = "contrib-row-r";
      const rk = document.createElement("span"); rk.className = "contrib-rank " + (idx < 3 ? `r${idx + 1}` : ""); rk.textContent = String(idx + 1);
      const av = document.createElement("div"); av.className = "contrib-row-av"; setAvatarContent(av, up.avatar_url, up.username);
      const nm = document.createElement("strong"); nm.textContent = up.username || "عضو"; nm.style.fontSize = "13px";
      rBox.append(rk, av, nm);
      const pTxt = document.createElement("strong"); pTxt.textContent = String(pts); pTxt.style.fontSize = "14px";
      row.append(rBox, pTxt);
      row.onclick = () => { $("dzLiveContributorsModal").hidden = true; openLiveUserCard(uid); };
      list.appendChild(row);
    });
  }

  const myPts = donors[currentUser?.id] || 0;
  const myRankIdx = ranked.findIndex(([uid]) => uid === currentUser?.id);
  $("contribMyName").textContent = currentProfile?.username || "أنت";
  $("contribMyPts").textContent = myPts > 0 ? `${myPts} ★ من النقاط` : "أرسل هدية لدخول الترتيب";
  $("contribMyRank").textContent = myRankIdx >= 0 ? String(myRankIdx + 1) : "-";
  setAvatarContent($("contribMyAv"), currentProfile?.avatar_url, "حسابي");
  $("dzLiveContributorsModal").hidden = false;
}
$("contribHelpBtn").addEventListener("click", () => showToast("تُحسب النقاط من مجموع الهدايا المُرسلة لهذا المقعد ★"));
$("contribSendGiftBtn").addEventListener("click", () => {
  const tid = activeContribGuestId;
  $("dzLiveContributorsModal").hidden = true;
  openLiveGiftsModal(tid);
});
$("dzLiveContributorsModal").addEventListener("click", e => { if (e.target === $("dzLiveContributorsModal")) $("dzLiveContributorsModal").hidden = true; });

function openLiveUserCard(uid) {
  if (!activeLiveRoom || !currentUser || !uid) return;
  activeLiveCardUserId = uid;
  const u = profilesMap[uid] || { id: uid, username: "عضو" };
  const isMe = uid === currentUser.id, isHost = activeLiveRoom.host_id === currentUser.id;
  const isTargetHost = uid === activeLiveRoom.host_id;
  const isSeated = liveSeatsCache.some(s => s.user_id === uid && s.status === "seated");

  $("liveCardName").textContent = u.username || "عضو";
  $("liveCardHandle").textContent = "@" + (u.username || "user");
  $("liveCardBadge").textContent = isTargetHost ? "👑 المضيف" : (isSeated ? "🎙️ ضيف" : "مشاهد");
  setAvatarContent($("liveCardAv"), u.avatar_url, u.username);

  const followers = followsCache.filter(f => f.following_id === uid).length;
  const following = followsCache.filter(f => f.follower_id === uid).length;
  $("liveCardStats").textContent = `${formatCount(followers)} من المتابعين • ${formatCount(following)} يتابعهم`;
  $("liveCardBio").textContent = u.bio || "لا توجد سيرة ذاتية";
  $("liveCardLevelTxt").textContent = `النقاط: ${liveSupportersMap[uid] || 0}`;
  $("liveCardStatusTxt").textContent = isTargetHost ? "صاحب البث" : (isSeated ? "على المقعد" : "مشاهد");

  $("liveCardModBtn").hidden = !isHost;
  $("liveCardFollowBtn").hidden = isMe;
  const iFollow = followsCache.some(f => f.follower_id === currentUser.id && f.following_id === uid);
  $("liveCardFollowBtn").classList.toggle("following", iFollow);
  $("liveCardFollowBtn").textContent = iFollow ? "✓ تتابعه" : "＋ متابعة";
  $("dzLiveUserCardModal").hidden = false;
}
$("dzLiveUserCardModal").addEventListener("click", e => { if (e.target === $("dzLiveUserCardModal")) $("dzLiveUserCardModal").hidden = true; });
$("liveCardFollowBtn").addEventListener("click", async () => {
  if (!activeLiveCardUserId) return;
  await toggleFollow(activeLiveCardUserId);
  openLiveUserCard(activeLiveCardUserId);
  updateLiveTopStatsUI();
});
$("liveCardMentionBtn").addEventListener("click", () => {
  if (!activeLiveCardUserId) return;
  const un = profilesMap[activeLiveCardUserId]?.username || "user";
  $("dzLiveUserCardModal").hidden = true;
  $("liveCommentInput").value = `@${un} ` + $("liveCommentInput").value;
  $("liveCommentInput").focus();
});
$("liveCardFullProfBtn").addEventListener("click", () => {
  const id = activeLiveCardUserId;
  $("dzLiveUserCardModal").hidden = true;
  if (id) openUserProfile(id);
});

function openLiveBanModal(targetUid = null) {
  if (!activeLiveRoom || activeLiveRoom.host_id !== currentUser?.id) return;
  const showTarget = targetUid && targetUid !== currentUser.id;
  $("liveBanTargetBox").hidden = !showTarget;
  if (showTarget) {
    const tu = profilesMap[targetUid] || {};
    $("liveBanTargetMsg").textContent = `حظر @${tu.username || "هذا المستخدم"} يمنعه نهائياً من دخول هذا البث ويلغي المتابعة فوراً.`;
    $("liveBanConfirmBtn").onclick = () => banUserFromLive(targetUid);
  }
  const meta = parseRoomMeta(activeLiveRoom.title);
  const bl = meta.bl || [];
  const list = $("liveBannedList"); list.textContent = "";
  if (!bl.length) {
    list.innerHTML = `<p style="text-align:center;color:#94a3b8;font-size:12px;padding:12px 0;">لا يوجد محظورون في هذا البث.</p>`;
  } else {
    bl.forEach(bUid => {
      const bp = profilesMap[bUid] || {};
      const row = document.createElement("div"); row.className = "banned-row";
      const sp = document.createElement("span"); sp.textContent = "@" + (bp.username || "مستخدم"); sp.style.fontSize = "13px"; sp.style.fontWeight = "700";
      const ub = document.createElement("button"); ub.type = "button"; ub.textContent = "إزالة الحظر";
      ub.onclick = () => unbanUserFromLive(bUid);
      row.append(sp, ub); list.appendChild(row);
    });
  }
  $("dzLiveBanModal").hidden = false;
}
$("liveCardModBtn").addEventListener("click", () => {
  const tid = activeLiveCardUserId;
  $("dzLiveUserCardModal").hidden = true;
  openLiveBanModal(tid);
});
$("dzCloseLiveBan").addEventListener("click", () => { $("dzLiveBanModal").hidden = true; });
$("dzLiveBanModal").addEventListener("click", e => { if (e.target === $("dzLiveBanModal")) $("dzLiveBanModal").hidden = true; });

async function banUserFromLive(targetUid) {
  if (!activeLiveRoom || !currentUser || activeLiveRoom.host_id !== currentUser.id || targetUid === currentUser.id) return;
  const meta = parseRoomMeta(activeLiveRoom.title);
  const nextBl = [...new Set([...(meta.bl || []), targetUid])];
  await updateLiveRoomMeta({ bl: nextBl });
  await db.from("live_seats").delete().match({ room_id: activeLiveRoom.id, user_id: targetUid });
  await db.from("follows").delete().match({ follower_id: currentUser.id, following_id: targetUid });
  await db.from("follows").delete().match({ follower_id: targetUid, following_id: currentUser.id });
  followsCache = followsCache.filter(f => !(
    (f.follower_id === currentUser.id && f.following_id === targetUid) ||
    (f.follower_id === targetUid && f.following_id === currentUser.id)
  ));
  if (liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "room-ban", payload: { user_id: targetUid } });
  liveViewerIds = liveViewerIds.filter(id => id !== targetUid);
  showToast("🚫 تم حظر المستخدم من البث وإلغاء المتابعة فوراً");
  await loadLiveRoomState();
  openLiveBanModal(null);
}

async function unbanUserFromLive(targetUid) {
  if (!activeLiveRoom || activeLiveRoom.host_id !== currentUser?.id) return;
  const meta = parseRoomMeta(activeLiveRoom.title);
  const nextBl = (meta.bl || []).filter(id => id !== targetUid);
  await updateLiveRoomMeta({ bl: nextBl });
  showToast("✅ تم إزالة الحظر عن المستخدم");
  openLiveBanModal(null);
}
/* === الأزرار السفلية، محرك LiveKit، وإعدادات الغرفة === */
$("liveQuickRoseBtn").addEventListener("click", () => {
  if (!activeLiveRoom) return;
  sendLiveGift("rose", selectedGiftTargetId || activeLiveRoom.host_id);
});
$("liveGuestsBtn").addEventListener("click", () => {
  if (!activeLiveRoom || !currentUser) return;
  if (activeLiveRoom.host_id === currentUser.id) {
    $("liveRequestsDrawer").hidden = !$("liveRequestsDrawer").hidden;
  } else {
    const mySeat = liveSeatsCache.find(s => s.user_id === currentUser.id);
    if (mySeat?.status === "seated") { if (confirm("هل تريد النزول من المقعد؟")) removeSeatRow(currentUser.id); }
    else if (mySeat?.status === "pending") { if (confirm("هل تريد إلغاء طلب الصعود؟")) removeSeatRow(currentUser.id); }
    else requestToJoinSeat();
  }
});
$("liveHostJoinBtn").addEventListener("click", async () => {
  if (!activeLiveRoom || !currentUser || activeLiveRoom.host_id === currentUser.id) return;
  await toggleFollow(activeLiveRoom.host_id);
  updateLiveTopStatsUI();
});
$("liveLikesBtn").addEventListener("click", () => {
  if (!activeLiveRoom) return;
  liveLikesCount++;
  updateLiveTopStatsUI();
  if (liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "room-stats", payload: { likes: liveLikesCount, shares: liveShareCount } });
});

async function fetchLiveKitToken(roomId) {
  const { data, error } = await db.functions.invoke("bright-service", { body: { room_id: roomId } });
  if (error) {
    let msg = error.message || "تعذر الاتصال بوظيفة livekit-token";
    try { if (error.context && typeof error.context.json === "function") { const eb = await error.context.json(); if (eb?.error) msg = eb.error; } } catch {}
    throw new Error(msg);
  }
  if (!data?.token || !data?.url) throw new Error(data?.error || "مفاتيح LiveKit غير مضبوطة في Supabase");
  return data;
}

function syncLocalMediaStreamFromLiveKit() {
  if (!livekitRoom?.localParticipant) { localMediaStream = null; return; }
  const tracks = [];
  const micPub = livekitRoom.localParticipant.getTrackPublication(LivekitClient.Track.Source.Microphone);
  const camPub = livekitRoom.localParticipant.getTrackPublication(LivekitClient.Track.Source.Camera);
  if (micPub?.track?.mediaStreamTrack) tracks.push(micPub.track.mediaStreamTrack);
  if (camPub?.track?.mediaStreamTrack && isCamEnabled) tracks.push(camPub.track.mediaStreamTrack);
  localMediaStream = tracks.length ? new MediaStream(tracks) : null;
}

async function disconnectLiveKitOnly() {
  if (liveMusicAudioTrack && livekitRoom?.localParticipant) {
    try { await livekitRoom.localParticipant.unpublishTrack(liveMusicAudioTrack); } catch {}
  }
  liveMusicAudioTrack = null;
  if (livekitRoom) { try { await livekitRoom.disconnect(); } catch {} livekitRoom = null; }
  localMediaStream = null; remoteMediaStreams = {}; $("liveAudioPool").textContent = "";
}

async function connectLiveKitRoom(roomId) {
  if (!window.LivekitClient) { showToast("تأكد من إضافة سطر مكتبة LiveKit في index.html"); return; }
  if (!activeLiveRoom || activeLiveRoom.id !== roomId || !currentUser) return;
  await disconnectLiveKitOnly();

  const isHost = activeLiveRoom.host_id === currentUser.id;
  const mySeat = liveSeatsCache.find(s => s.user_id === currentUser.id && s.status === "seated");
  amISpeakerNow = isHost || !!mySeat;

  let creds;
  try { creds = await fetchLiveKitToken(roomId); } catch (err) { showToast("❌ خطأ LiveKit: " + (err.message || err)); return; }
  if (!activeLiveRoom || activeLiveRoom.id !== roomId) return;

  const lkRoom = new LivekitClient.Room({
    adaptiveStream: true, dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    videoCaptureDefaults: { resolution: LivekitClient.VideoPresets.h720.resolution }
  });
  livekitRoom = lkRoom;

  lkRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (livekitRoom !== lkRoom) return;
    const uid = participant.identity;
    if (track.kind === LivekitClient.Track.Kind.Audio) {
      const audioEl = track.attach();
      audioEl.id = "aud_" + (track.sid || uid); audioEl.autoplay = true; audioEl.playsInline = true; audioEl.muted = false; audioEl.volume = 1;
      $("liveAudioPool").appendChild(audioEl);
      const p = audioEl.play(); if (p && p.catch) p.catch(() => { liveAudioUnlockBtn.hidden = false; });
    } else if (track.kind === LivekitClient.Track.Kind.Video) {
      if (!remoteMediaStreams[uid]) remoteMediaStreams[uid] = new MediaStream();
      const rs = remoteMediaStreams[uid];
      rs.getVideoTracks().forEach(t => rs.removeTrack(t));
      if (track.mediaStreamTrack) rs.addTrack(track.mediaStreamTrack);
      renderLiveSeatsAndControls();
    }
  });
  lkRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    const uid = participant.identity;
    if (track.kind === LivekitClient.Track.Kind.Audio) track.detach().forEach(el => el.remove());
    else if (track.kind === LivekitClient.Track.Kind.Video) {
      if (remoteMediaStreams[uid]) remoteMediaStreams[uid].getVideoTracks().forEach(t => remoteMediaStreams[uid].removeTrack(t));
      renderLiveSeatsAndControls();
    }
  });
  lkRoom.on(LivekitClient.RoomEvent.ParticipantDisconnected, participant => { delete remoteMediaStreams[participant.identity]; renderLiveSeatsAndControls(); });
  lkRoom.on(LivekitClient.RoomEvent.AudioPlaybackStatusChanged, () => { liveAudioUnlockBtn.hidden = lkRoom.canPlaybackAudio; });
  lkRoom.on(LivekitClient.RoomEvent.LocalTrackPublished, () => { syncLocalMediaStreamFromLiveKit(); renderLiveSeatsAndControls(); });
  lkRoom.on(LivekitClient.RoomEvent.LocalTrackUnpublished, () => { syncLocalMediaStreamFromLiveKit(); renderLiveSeatsAndControls(); });

  try {
    await lkRoom.connect(creds.url, creds.token);
    if (livekitRoom !== lkRoom) { try { await lkRoom.disconnect(); } catch {} return; }
    try { await lkRoom.startAudio(); } catch {}
    if (!lkRoom.canPlaybackAudio) liveAudioUnlockBtn.hidden = false;

    if (amISpeakerNow) {
      if (!isHost && mySeat) isMicMuted = !!mySeat.is_muted;
      try { await lkRoom.localParticipant.setMicrophoneEnabled(!isMicMuted); } catch { showToast("تأكد من منح إذن الميكروفون للمتصفح"); }
      if (isCamEnabled) { try { await lkRoom.localParticipant.setCameraEnabled(true, { facingMode: currentCamFacing }); } catch { isCamEnabled = false; } }
      syncLocalMediaStreamFromLiveKit();
      renderLiveSeatsAndControls();
      if (liveMusicAudio && !liveMusicAudio.paused) await mixMusicIntoPeers();
    }
  } catch (err) { showToast("❌ تعذر الاتصال بالبث الصوتي: " + (err.message || err)); }
}

async function toggleSeatCamera() {
  if (!activeLiveRoom || !currentUser || !livekitRoom) return;
  if (isCamEnabled) {
    isCamEnabled = false;
    try { await livekitRoom.localParticipant.setCameraEnabled(false); } catch {}
    syncLocalMediaStreamFromLiveKit(); renderLiveSeatsAndControls(); showToast("تم غلق الكاميرا 📷"); return;
  }
  try {
    await livekitRoom.localParticipant.setCameraEnabled(true, { facingMode: currentCamFacing });
    isCamEnabled = true; syncLocalMediaStreamFromLiveKit(); renderLiveSeatsAndControls(); showToast("تم فتح الكاميرا 📹");
  } catch { showToast("تعذر تشغيل الكاميرا"); }
}

async function flipSeatCamera() {
  if (!activeLiveRoom || !currentUser || !livekitRoom) return;
  currentCamFacing = currentCamFacing === "user" ? "environment" : "user";
  if (!isCamEnabled) { await toggleSeatCamera(); return; }
  try {
    const camPub = livekitRoom.localParticipant.getTrackPublication(LivekitClient.Track.Source.Camera);
    if (camPub?.track?.restartTrack) await camPub.track.restartTrack({ facingMode: currentCamFacing });
    else { await livekitRoom.localParticipant.setCameraEnabled(false); await livekitRoom.localParticipant.setCameraEnabled(true, { facingMode: currentCamFacing }); }
    syncLocalMediaStreamFromLiveKit(); renderLiveSeatsAndControls();
    showToast(currentCamFacing === "user" ? "الكاميرا الأمامية 🤳" : "الكاميرا الخلفية 📷");
  } catch { showToast("تعذر تبديل الكاميرا"); }
}

seatPhotoInput.addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file || !currentUser || !activeLiveRoom) return;
  if (!isSafeImageFile(file, 5)) { e.target.value = ""; return; }
  showToast("جارٍ وضع الصورة في المقعد...");
  try {
    const ext = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${currentUser.id}/seatdecor_${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (upErr) throw upErr;
    const url = db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    mySeatDecorUrl = url; seatDecorMap[currentUser.id] = url; isCamEnabled = false;
    if (livekitRoom) await livekitRoom.localParticipant.setCameraEnabled(false).catch(() => {});
    syncLocalMediaStreamFromLiveKit();
    if (liveRoomChannel) {
      liveRoomChannel.send({ type: "broadcast", event: "seat-decor", payload: { user_id: currentUser.id, url } });
      await liveRoomChannel.track({ user_id: currentUser.id, is_speaker: amISpeakerNow, decor: url, points_map: liveGiftPointsMap, supporters_map: liveSupportersMap, donors_map: liveRecipientDonorsMap });
    }
    renderLiveSeatsAndControls(); showToast("تم تزيين المقعد بالصورة ✅");
  } catch (err) { showToast("تعذر وضع الصورة: " + err.message); }
  e.target.value = "";
});

async function requestToJoinSeat() {
  if (!activeLiveRoom || !currentUser || !checkRateLimit("joinSeat", 1000)) return;
  try {
    const { error } = await db.from("live_seats").upsert({ room_id: activeLiveRoom.id, user_id: currentUser.id, status: "pending", seat_number: null, is_muted: false }, { onConflict: "room_id,user_id" });
    if (error) throw error;
    showToast("تم إرسال طلب الصعود للمضيف ✋"); await loadLiveRoomState();
  } catch (err) { alert("تعذر إرسال الطلب:\n" + err.message); }
}

async function approveGuestRequest(userId) {
  if (!activeLiveRoom) return;
  const taken = new Set(liveSeatsCache.filter(s => s.status === "seated").map(s => s.seat_number));
  let free = null; for (let i = 2; i <= 9; i++) { if (!taken.has(i)) { free = i; break; } }
  if (!free) { showToast("جميع مقاعد الضيوف ممتلئة!"); return; }
  try {
    const { error } = await db.from("live_seats").update({ status: "seated", seat_number: free, is_muted: false }).match({ room_id: activeLiveRoom.id, user_id: userId });
    if (error) throw error;
    const gn = profilesMap[userId]?.username || "ضيف";
    await db.from("live_comments").insert({ room_id: activeLiveRoom.id, user_id: currentUser.id, content: `✅ صعد @${gn} إلى المقعد رقم ${free}` });
    await loadLiveRoomState();
  } catch (err) { alert("تعذر قبول الضيف:\n" + err.message); }
}

async function removeSeatRow(userId) {
  if (!activeLiveRoom) return;
  const { error } = await db.from("live_seats").delete().match({ room_id: activeLiveRoom.id, user_id: userId });
  if (error) showToast("تعذر التنفيذ: " + error.message);
  else await loadLiveRoomState();
}

async function toggleMyLiveMic() {
  isMicMuted = !isMicMuted;
  if (livekitRoom && amISpeakerNow) {
    try { await livekitRoom.localParticipant.setMicrophoneEnabled(!isMicMuted); }
    catch (err) { showToast("تعذر التحكم بالمايك: " + (err.message || "")); }
  }
  if (activeLiveRoom && currentUser && activeLiveRoom.host_id !== currentUser.id) {
    await db.from("live_seats").update({ is_muted: isMicMuted }).match({ room_id: activeLiveRoom.id, user_id: currentUser.id });
  }
  renderLiveSeatsAndControls();
  showToast(isMicMuted ? "تم كتم المايك 🔇" : "المايك مفتوح 🎙️");
}

$("liveSettingsBtn").addEventListener("click", () => {
  if (!activeLiveRoom) return;
  const meta = parseRoomMeta(activeLiveRoom.title);
  $("livePinInput").value = meta.p || "";
  $("liveBgPresets").querySelectorAll(".bg-swatch").forEach(b => b.classList.toggle("selected", b.dataset.bg === meta.b));
  applyCommentsVisibilityUI();
  $("dzLiveSettingsModal").hidden = false;
});
$("dzCloseLiveSettings").addEventListener("click", () => { $("dzLiveSettingsModal").hidden = true; });
$("dzLiveSettingsModal").addEventListener("click", e => { if (e.target === $("dzLiveSettingsModal")) $("dzLiveSettingsModal").hidden = true; });

async function updateLiveRoomMeta(patch) {
  if (!activeLiveRoom || !currentUser) return;
  const meta = { ...parseRoomMeta(activeLiveRoom.title), ...patch }, packed = packRoomMeta(meta);
  const { error } = await db.from("live_rooms").update({ title: packed }).eq("id", activeLiveRoom.id);
  if (error) { showToast("فشل تحديث الخصائص: " + error.message); return; }
  activeLiveRoom.title = packed; $("liveRoomTitle").textContent = (meta.p ? "🔒 " : "") + meta.t;
  applyLiveRoomBackground(meta.b);
  applyCommentsVisibilityUI();
  renderSpotlightStage();
  if (liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "room-meta", payload: meta });
}

$("liveBgPresets").addEventListener("click", async e => {
  const btn = e.target.closest(".bg-swatch"); if (!btn) return;
  $("liveBgPresets").querySelectorAll(".bg-swatch").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected"); await updateLiveRoomMeta({ b: btn.dataset.bg }); showToast("تم تغيير خلفية الغرفة 🎨");
});

$("liveBgFile").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file || !currentUser) return;
  if (!isSafeImageFile(file, 5)) { e.target.value = ""; return; }
  showToast("جارٍ رفع الخلفية...");
  try {
    const ext = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${currentUser.id}/livebg_${Date.now()}.${ext}`;
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type || "image/jpeg" });
    if (error) throw error;
    await updateLiveRoomMeta({ b: db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl });
    showToast("تم تعيين صورة الخلفية ✅");
  } catch (err) { showToast("فشل رفع الخلفية: " + err.message); }
  e.target.value = "";
});

$("liveSaveSettingsBtn").addEventListener("click", async () => {
  const pin = $("livePinInput").value.trim();
  if (pin && !/^\d{4}$/.test(pin)) { showToast("المفتاح السري يجب أن يتكون من 4 أرقام فقط"); return; }
  await updateLiveRoomMeta({ p: pin }); $("dzLiveSettingsModal").hidden = true;
  showToast(pin ? "تم قفل الغرفة بالمفتاح السري 🔒" : "الغرفة الآن مفتوحة بدون رمز 🔓");
});

$("liveToggleHideCommentsBtn").addEventListener("click", async () => {
  if (!activeLiveRoom) return;
  const nextHc = !parseRoomMeta(activeLiveRoom.title).hc;
  await updateLiveRoomMeta({ hc: nextHc });
  showToast(nextHc ? "تم إخفاء التعليقات 🙈" : "تم إظهار التعليقات 👁️");
});

$("liveClearCommentsBtn").addEventListener("click", async () => {
  if (!activeLiveRoom || activeLiveRoom.host_id !== currentUser?.id) return;
  liveCommentsCache = [];
  renderLiveComments();
  await db.from("live_comments").delete().eq("room_id", activeLiveRoom.id);
  if (liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "clear-comments", payload: {} });
  $("dzLiveSettingsModal").hidden = true;
  showToast("تم حذف جميع تعليقات البث 🗑️");
});

$("liveMusicFile").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
  if (liveMusicAudioTrack && livekitRoom?.localParticipant) {
    try { await livekitRoom.localParticipant.unpublishTrack(liveMusicAudioTrack); } catch {}
    liveMusicAudioTrack = null;
  }
  if (liveMusicAudio) { liveMusicAudio.pause(); liveMusicAudio = null; }
  liveMusicAudio = new Audio(URL.createObjectURL(file)); liveMusicAudio.loop = true;
  liveMusicAudio.volume = parseFloat($("liveMusicVol").value || "0.4");
  $("liveMusicStatus").textContent = "المقطع: " + file.name; $("liveMusicToggleBtn").disabled = false;
  liveMusicAudio.play().then(() => { $("liveMusicToggleBtn").textContent = "⏸️ إيقاف"; mixMusicIntoPeers(); }).catch(() => {});
});
$("liveMusicToggleBtn").addEventListener("click", () => {
  if (!liveMusicAudio) return;
  if (liveMusicAudio.paused) {
    liveMusicAudio.play().then(() => {
      $("liveMusicToggleBtn").textContent = "⏸️ إيقاف";
      if (liveMusicAudioTrack?.unmute) liveMusicAudioTrack.unmute(); else mixMusicIntoPeers();
    }).catch(() => {});
  } else {
    liveMusicAudio.pause(); $("liveMusicToggleBtn").textContent = "▶️ تشغيل";
    if (liveMusicAudioTrack?.mute) liveMusicAudioTrack.mute();
  }
});
$("liveMusicVol").addEventListener("input", () => { if (liveMusicAudio) liveMusicAudio.volume = parseFloat($("liveMusicVol").value || "0.4"); });

async function mixMusicIntoPeers() {
  if (!liveMusicAudio || !livekitRoom || !amISpeakerNow) return;
  try {
    if (!liveAudioCtx) liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (liveAudioCtx.state === "suspended") await liveAudioCtx.resume();
    if (!liveMixedDest) liveMixedDest = liveAudioCtx.createMediaStreamDestination();
    if (!liveMusicAudio._srcNode) {
      liveMusicAudio._srcNode = liveAudioCtx.createMediaElementSource(liveMusicAudio);
      liveMusicAudio._srcNode.connect(liveMixedDest);
      liveMusicAudio._srcNode.connect(liveAudioCtx.destination);
    }
    const mt = liveMixedDest.stream.getAudioTracks()[0];
    if (mt && !liveMusicAudioTrack) {
      const pub = await livekitRoom.localParticipant.publishTrack(mt, { name: "live-music" });
      liveMusicAudioTrack = pub?.track || mt;
    }
  } catch {}
}
/* === نافذة المشاركة الاحترافية === */
function renderLiveShareFriends() {
  if (!activeLiveRoom || !currentUser) return;
  const q = ($("liveShareSearchInput")?.value || "").trim().toLowerCase();
  const row = $("liveShareFriendsRow"); row.textContent = "";
  const friends = Object.values(profilesMap).filter(p => p.id !== currentUser.id && !isUserBlocked(p.id) && (p.username || "").toLowerCase().includes(q));
  if (!friends.length) row.innerHTML = `<p style="font-size:12px;color:#64748b;padding:8px">لا يوجد أصدقاء مطابقون.</p>`;
  else friends.forEach(f => {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "live-share-friend";
    const av = document.createElement("div"); av.className = "av" + (onlineUserIds.has(f.id) ? " online" : ""); setAvatarContent(av, f.avatar_url, f.username);
    const sm = document.createElement("small"); sm.textContent = f.username;
    btn.append(av, sm);
    btn.onclick = async () => {
      if (!checkRateLimit("shareFriend", 600)) return;
      const meta = parseRoomMeta(activeLiveRoom.title), hn = profilesMap[activeLiveRoom.host_id]?.username || "host";
      const { error } = await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: f.id, content: JSON.stringify({ dz_live_invite: true, roomId: activeLiveRoom.id, title: meta.t, hostName: hn }) });
      if (error) $("liveShareStatus").textContent = "تعذر الإرسال: " + error.message;
      else {
        liveShareCount++; updateLiveTopStatsUI();
        if (liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "room-stats", payload: { likes: liveLikesCount, shares: liveShareCount } });
        $("liveShareStatus").textContent = `✅ تم إرسال دعوة البث إلى @${f.username}`;
      }
    };
    row.appendChild(btn);
  });
}

$("liveShareBtn").addEventListener("click", () => {
  if (!activeLiveRoom || !currentUser) return;
  $("liveShareStatus").textContent = "";
  $("liveShareSearchWrap").hidden = true;
  if ($("liveShareSearchInput")) $("liveShareSearchInput").value = "";
  renderLiveShareFriends();

  const meta = parseRoomMeta(activeLiveRoom.title), hn = profilesMap[activeLiveRoom.host_id]?.username || "host";
  const shareUrl = window.location.href;
  const shareText = `🔴 انضم إلى بث @${hn} المباشر على DZ-CHAT: ${meta.t}\n${shareUrl}`;

  const incShare = () => {
    liveShareCount++; updateLiveTopStatsUI();
    if (liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "room-stats", payload: { likes: liveLikesCount, shares: liveShareCount } });
  };

  const extRow = $("liveShareExternalRow"); extRow.textContent = "";
  const extItems = [
    { label: "إعادة النشر", ico: "🔁", bg: "#f59e0b", fn: async () => {
      if (!checkRateLimit("sharePub", 1000)) return;
      await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: null, content: JSON.stringify({ dz_live_invite: true, roomId: activeLiveRoom.id, title: meta.t, hostName: hn }) });
      incShare(); $("liveShareStatus").textContent = "✅ تمت مشاركة البث في الشات العام";
    }},
    { label: "نسخ الرابط", ico: "🔗", bg: "#2563eb", fn: async () => {
      try { await navigator.clipboard.writeText(shareUrl); } catch {}
      incShare(); $("liveShareStatus").textContent = "✅ تم نسخ رابط البث";
    }},
    { label: "WhatsApp", ico: "💬", bg: "#22c55e", fn: () => { incShare(); window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer"); } },
    { label: "Telegram", ico: "✈️", bg: "#0ea5e9", fn: () => { incShare(); window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer"); } },
    { label: "Messenger", ico: "⚡", bg: "#6366f1", fn: async () => { incShare(); if (navigator.share) { try { await navigator.share({ title: meta.t, text: shareText, url: shareUrl }); return; } catch {} } window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, "_blank", "noopener,noreferrer"); } },
    { label: "Facebook", ico: "f", bg: "#1877f2", fn: () => { incShare(); window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, "_blank", "noopener,noreferrer"); } }
  ];
  extItems.forEach(it => {
    const b = document.createElement("button"); b.type = "button"; b.className = "share-app-btn";
    b.innerHTML = `<span class="share-app-ico" style="background:${it.bg}">${it.ico}</span><small>${it.label}</small>`;
    b.onclick = it.fn; extRow.appendChild(b);
  });

  const qRow = $("liveShareQuickRow"); qRow.textContent = "";
  const qItems = [
    { label: "مشاركة سريعة", ico: "📤", fn: async () => { if (navigator.share) { try { await navigator.share({ title: meta.t, text: shareText, url: shareUrl }); incShare(); } catch {} } else showToast("استخدم نسخ الرابط أو واتساب"); } },
    { label: "إبلاغ", ico: "🚩", fn: () => { $("dzLiveShareModal").hidden = true; showToast("تم استلام البلاغ للمراجعة 🚩"); } },
    { label: "الملاحظات", ico: "❓", fn: () => { $("dzLiveShareModal").hidden = true; showToast("شكراً لملاحظاتك لتحسين DZ-CHAT 💙"); } }
  ];
  qItems.forEach(it => {
    const b = document.createElement("button"); b.type = "button"; b.className = "share-app-btn";
    b.innerHTML = `<span class="share-app-ico" style="background:#f1f2f5;color:#161823">${it.ico}</span><small>${it.label}</small>`;
    b.onclick = it.fn; qRow.appendChild(b);
  });
  $("dzLiveShareModal").hidden = false;
});
$("liveShareSearchToggle").addEventListener("click", () => {
  $("liveShareSearchWrap").hidden = !$("liveShareSearchWrap").hidden;
  if (!$("liveShareSearchWrap").hidden) $("liveShareSearchInput").focus();
});
$("liveShareSearchInput").addEventListener("input", renderLiveShareFriends);
$("dzCloseLiveShare").addEventListener("click", () => { $("dzLiveShareModal").hidden = true; });
$("dzLiveShareModal").addEventListener("click", e => { if (e.target === $("dzLiveShareModal")) $("dzLiveShareModal").hidden = true; });

function renderLiveComments() {
  const box = $("liveCommentsArea"); box.textContent = "";
  liveCommentsCache.forEach(c => {
    if (c.content.startsWith("🎁 أرسل")) return;
    const prof = profilesMap[c.user_id] || {}, uname = prof.username || "عضو", pill = document.createElement("div");
    const isSys = c.content.startsWith("✅ صعد") || c.content.startsWith("👋 دخل") || c.content.startsWith("🚪 غادر");
    pill.className = "live-comment-pill" + (isSys ? " sys" : "");
    if (isSys) {
      pill.textContent = c.content;
    } else {
      const av = document.createElement("div"); av.className = "live-comment-av"; setAvatarContent(av, prof.avatar_url, uname);
      av.onclick = () => openLiveUserCard(c.user_id);
      pill.appendChild(av);
      if (activeLiveRoom && c.user_id === activeLiveRoom.host_id) {
        const ht = document.createElement("span"); ht.className = "live-comment-host-tag"; ht.textContent = "المضيف";
        pill.appendChild(ht);
      }
      const st = document.createElement("strong"); st.textContent = uname + ":";
      st.onclick = () => openLiveUserCard(c.user_id);
      const tx = document.createElement("span"); tx.textContent = c.content;
      pill.append(st, tx);
    }
    box.appendChild(pill);
  });
  box.scrollTop = box.scrollHeight;
}
$("liveReqToggleBtn").addEventListener("click", () => { $("liveRequestsDrawer").hidden = !$("liveRequestsDrawer").hidden; });
$("liveCommentForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!currentUser || !activeLiveRoom) return;
  const content = cleanText($("liveCommentInput").value, 300); if (!content || !checkRateLimit("liveComment", 400)) return;
  $("liveCommentInput").value = "";
  const { error } = await db.from("live_comments").insert({ room_id: activeLiveRoom.id, user_id: currentUser.id, content });
  if (error) showToast("فشل إرسال التعليق: " + error.message);
});

$("liveExitBtn").addEventListener("click", async () => {
  if (!activeLiveRoom || !currentUser) return;
  if (activeLiveRoom.host_id === currentUser.id) {
    $("dzLiveExitConfirmModal").hidden = false;
  } else {
    await db.from("live_seats").delete().match({ room_id: activeLiveRoom.id, user_id: currentUser.id });
    leaveLiveRoom(false);
  }
});
$("liveExitCancelBtn").addEventListener("click", () => { $("dzLiveExitConfirmModal").hidden = true; });
$("liveExitConfirmBtn").addEventListener("click", async () => {
  $("dzLiveExitConfirmModal").hidden = true;
  if (!activeLiveRoom || !currentUser) return;
  if (liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "room-ended", payload: {} });
  await db.from("live_rooms").update({ is_active: false }).eq("id", activeLiveRoom.id);
  leaveLiveRoom(false);
});

function leaveLiveRoom(silent = false) {
  disconnectLiveKitOnly();
  liveAudioUnlockBtn.hidden = true;
  clearTimeout(giftAnimTimeout);
  liveGiftQueue = []; isPlayingGiftAnim = false;
  if ($("liveGiftOverlay")) $("liveGiftOverlay").hidden = true;
  if (liveMusicAudio) { liveMusicAudio.pause(); liveMusicAudio = null; }
  if (liveMixedDest) { liveMixedDest = null; }
  if (liveRoomChannel) { db.removeChannel(liveRoomChannel); liveRoomChannel = null; }
  amISpeakerNow = false; activeLiveRoom = null; seatDecorMap = {}; mySeatDecorUrl = "";
  liveGiftPointsMap = {}; liveSupportersMap = {}; liveRecipientDonorsMap = {}; liveViewerIds = [];
  ["dzLiveRoom", "dzLiveGiftsModal", "dzLiveViewersModal", "dzLiveContributorsModal", "dzLiveUserCardModal", "dzLiveBanModal", "dzLiveExitConfirmModal", "dzLiveShareModal", "dzLiveSettingsModal", "dzSeatActionModal"].forEach(id => {
    if ($(id)) $(id).hidden = true;
  });
  if (!silent) refreshAllData(false);
}

async function syncSpeakerMediaAndPresence() {
  if (!activeLiveRoom || !currentUser || !liveRoomChannel || !livekitRoom) return;
  const isHost = activeLiveRoom.host_id === currentUser.id;
  const mySeat = liveSeatsCache.find(s => s.user_id === currentUser.id && s.status === "seated");
  const shouldSpeak = isHost || !!mySeat;
  if (shouldSpeak !== amISpeakerNow && !liveSpeakerSyncLock) {
    liveSpeakerSyncLock = true;
    try {
      await connectLiveKitRoom(activeLiveRoom.id);
      if (liveRoomChannel) {
        await liveRoomChannel.track({ user_id: currentUser.id, is_speaker: amISpeakerNow, decor: mySeatDecorUrl, points_map: liveGiftPointsMap, supporters_map: liveSupportersMap, donors_map: liveRecipientDonorsMap });
      }
    } finally { liveSpeakerSyncLock = false; }
  }
}

async function setupLiveRoomRealtime(roomId) {
  if (liveRoomChannel) db.removeChannel(liveRoomChannel);
  const isHost = activeLiveRoom.host_id === currentUser.id;
  const mySeat = liveSeatsCache.find(s => s.user_id === currentUser.id && s.status === "seated");
  amISpeakerNow = isHost || !!mySeat;

  liveRoomChannel = db.channel("live-room-" + roomId, { config: { presence: { key: currentUser.id } } });
  liveRoomChannel
    .on("postgres_changes", { event: "*", schema: "public", table: "live_seats", filter: `room_id=eq.${roomId}` }, async () => { await loadLiveRoomState(); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_comments", filter: `room_id=eq.${roomId}` }, async payload => {
      const c = payload.new;
      if (!profilesMap[c.user_id]) { const { data } = await db.from("profiles").select("*").eq("id", c.user_id).maybeSingle(); if (data) profilesMap[data.id] = data; }
      if (!liveCommentsCache.some(x => x.id === c.id)) { liveCommentsCache.push(c); renderLiveComments(); }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_rooms", filter: `id=eq.${roomId}` }, payload => {
      if (payload.new?.is_active === false) { showToast("انتهى البث المباشر"); leaveLiveRoom(false); }
      else if (payload.new && activeLiveRoom) {
        activeLiveRoom.title = payload.new.title; const m = parseRoomMeta(payload.new.title);
        if (m.bl && m.bl.includes(currentUser.id) && activeLiveRoom.host_id !== currentUser.id) {
          showToast("🚫 تم حظرك من دخول هذا البث"); leaveLiveRoom(false); return;
        }
        $("liveRoomTitle").textContent = (m.p ? "🔒 " : "") + m.t; applyLiveRoomBackground(m.b); applyCommentsVisibilityUI(); renderSpotlightStage();
      }
    })
    .on("broadcast", { event: "room-meta" }, ({ payload }) => {
      if (payload && activeLiveRoom) {
        activeLiveRoom.title = packRoomMeta(payload);
        if (payload.bl && payload.bl.includes(currentUser.id) && activeLiveRoom.host_id !== currentUser.id) {
          showToast("🚫 تم حظرك من دخول هذا البث"); leaveLiveRoom(false); return;
        }
        $("liveRoomTitle").textContent = (payload.p ? "🔒 " : "") + payload.t;
        applyLiveRoomBackground(payload.b); applyCommentsVisibilityUI(); renderSpotlightStage();
      }
    })
    .on("broadcast", { event: "room-ended" }, () => { showToast("انتهى البث المباشر"); leaveLiveRoom(false); })
    .on("broadcast", { event: "room-ban" }, ({ payload }) => {
      if (payload?.user_id === currentUser?.id) { showToast("🚫 تم حظرك من دخول هذا البث"); leaveLiveRoom(false); }
    })
    .on("broadcast", { event: "clear-comments" }, () => { liveCommentsCache = []; renderLiveComments(); })
    .on("broadcast", { event: "seat-decor" }, ({ payload }) => {
      if (payload?.user_id) {
        const su = payload.url ? safeUrl(payload.url, false) : "";
        if (su) seatDecorMap[payload.user_id] = su; else delete seatDecorMap[payload.user_id];
        renderLiveSeatsAndControls();
      }
    })
    .on("broadcast", { event: "live-gift" }, ({ payload }) => {
      if (!payload || !activeLiveRoom) return;
      if (payload.recipientId) {
        liveGiftPointsMap[payload.recipientId] = Math.max(liveGiftPointsMap[payload.recipientId] || 0, Number(payload.totalPoints) || 0);
        if (payload.senderId) {
          if (!liveRecipientDonorsMap[payload.recipientId]) liveRecipientDonorsMap[payload.recipientId] = {};
          liveRecipientDonorsMap[payload.recipientId][payload.senderId] = Math.max(liveRecipientDonorsMap[payload.recipientId][payload.senderId] || 0, Number(payload.senderToRecTotal) || Number(payload.points) || 0);
        }
        updateLivePointsBadges();
      }
      if (payload.senderId && payload.senderTotal) {
        liveSupportersMap[payload.senderId] = Math.max(liveSupportersMap[payload.senderId] || 0, Number(payload.senderTotal) || 0);
        renderTopSupporters();
      }
      enqueueLiveGiftAnimation(payload);
    })
    .on("broadcast", { event: "room-stats" }, ({ payload }) => {
      if (!payload || !activeLiveRoom) return;
      if (typeof payload.likes === "number") liveLikesCount = Math.max(liveLikesCount, payload.likes);
      if (typeof payload.shares === "number") liveShareCount = Math.max(liveShareCount, payload.shares);
      updateLiveTopStatsUI();
    })
    .on("presence", { event: "sync" }, () => {
      const peers = Object.values(liveRoomChannel.presenceState()).flat();
      liveViewerIds = [...new Set(peers.map(p => p?.user_id).filter(Boolean))];
      liveViewersCount = Math.max(1, liveViewerIds.length);
      let decorChanged = false, pointsChanged = false, supChanged = false;
      for (const p of peers) {
        if (!p.user_id) continue;
        if (p.decor !== undefined) {
          const prev = seatDecorMap[p.user_id] || "";
          const nextD = p.decor ? safeUrl(p.decor, false) : "";
          if (prev !== nextD) { if (nextD) seatDecorMap[p.user_id] = nextD; else delete seatDecorMap[p.user_id]; decorChanged = true; }
        }
        if (p.points_map && typeof p.points_map === "object") {
          for (const [uid, pts] of Object.entries(p.points_map)) { if ((Number(pts) || 0) > (liveGiftPointsMap[uid] || 0)) { liveGiftPointsMap[uid] = Number(pts) || 0; pointsChanged = true; } }
        }
        if (p.supporters_map && typeof p.supporters_map === "object") {
          for (const [uid, pts] of Object.entries(p.supporters_map)) { if ((Number(pts) || 0) > (liveSupportersMap[uid] || 0)) { liveSupportersMap[uid] = Number(pts) || 0; supChanged = true; } }
        }
        if (p.donors_map && typeof p.donors_map === "object") {
          for (const [recId, dObj] of Object.entries(p.donors_map)) {
            if (!liveRecipientDonorsMap[recId]) liveRecipientDonorsMap[recId] = {};
            for (const [sId, pts] of Object.entries(dObj || {})) {
              if ((Number(pts) || 0) > (liveRecipientDonorsMap[recId][sId] || 0)) liveRecipientDonorsMap[recId][sId] = Number(pts) || 0;
            }
          }
        }
      }
      if (decorChanged) renderLiveSeatsAndControls();
      if (pointsChanged) updateLivePointsBadges();
      if (supChanged) renderTopSupporters();
      updateLiveTopStatsUI();
    })
    .subscribe(async status => {
      if (status === "SUBSCRIBED") {
        await liveRoomChannel.track({ user_id: currentUser.id, is_speaker: amISpeakerNow, decor: mySeatDecorUrl, points_map: liveGiftPointsMap, supporters_map: liveSupportersMap, donors_map: liveRecipientDonorsMap });
      }
    });

  await connectLiveKitRoom(roomId);
}
function buildFeedSlide(post) {
  const slide = document.createElement("div");
  slide.className = "video-slide";
  slide.dataset.videoId = post.id;
  const mediaSrc = safeUrl(post.video_url, false);

  if (isImagePost(post)) {
    const imgEl = document.createElement("img");
    imgEl.className = "feed-photo"; imgEl.src = mediaSrc; imgEl.alt = post.caption || "صورة";
    slide.appendChild(imgEl);
  } else {
    const vidEl = document.createElement("video");
    vidEl.src = mediaSrc; vidEl.playsInline = true; vidEl.loop = true; vidEl.preload = "metadata";
    vidEl.addEventListener("click", () => { if (vidEl.paused) vidEl.play().catch(() => {}); else vidEl.pause(); });
    slide.appendChild(vidEl);
  }

  const grad = document.createElement("div"); grad.className = "video-gradient";
  const creator = profilesMap[post.user_id] || {}, creatorName = (creator.username || "dz_user").replace(/^@/, "");
  const info = document.createElement("div"); info.className = "video-info";
  const strong = document.createElement("strong"); strong.textContent = "@" + creatorName;
  strong.addEventListener("click", e => { e.stopPropagation(); openUserProfile(post.user_id); });
  const p = document.createElement("p"); p.textContent = post.caption || "منشور من مجتمع DZ-CHAT 🇩🇿";
  const small = document.createElement("small"); small.textContent = isImagePost(post) ? "🖼️ صورة - DZ-CHAT" : "🎵 الصوت الأصلي - " + creatorName;
  info.append(strong, p, small);

  const actions = document.createElement("div"); actions.className = "video-actions";
  const avBtn = document.createElement("button"); avBtn.type = "button";
  avBtn.className = "action-creator-av" + (liveRoomsCache.some(r => r.host_id === post.user_id) ? " is-live" : "");
  setAvatarContent(avBtn, creator.avatar_url, creatorName);
  avBtn.addEventListener("click", e => { e.stopPropagation(); openUserProfile(post.user_id); });
  actions.appendChild(avBtn);

  const videoLikes = likesCache.filter(l => l.video_id === post.id), isLiked = currentUser && videoLikes.some(l => l.user_id === currentUser.id);
  const likeBtn = document.createElement("button"); likeBtn.type = "button"; likeBtn.className = "action like-btn" + (isLiked ? " liked" : "");
  likeBtn.innerHTML = `<span>♥</span><small>${formatCount(videoLikes.length)}</small>`;
  likeBtn.addEventListener("click", e => { e.stopPropagation(); toggleLike(post.id); });

  const commentBtn = document.createElement("button"); commentBtn.type = "button"; commentBtn.className = "action comment-btn";
  commentBtn.innerHTML = `<span>💬</span><small>${commentsCache.filter(c => c.video_id === post.id).length}</small>`;
  commentBtn.addEventListener("click", e => { e.stopPropagation(); openComments(post.id); });

  const isSaved = getSavedPostIds().includes(post.id);
  const saveBtn = document.createElement("button"); saveBtn.type = "button"; saveBtn.className = "action";
  saveBtn.innerHTML = `<span>${isSaved ? "🔖" : "🏷️"}</span><small>${isSaved ? "محفوظ" : "حفظ"}</small>`;
  saveBtn.addEventListener("click", e => {
    e.stopPropagation(); const s = toggleSavedPostId(post.id);
    saveBtn.querySelector("span").textContent = s ? "🔖" : "🏷️";
    saveBtn.querySelector("small").textContent = s ? "محفوظ" : "حفظ";
    renderProfile(); showToast(s ? "تم الحفظ في المحفوظات 🔖" : "تمت الإزالة من المحفوظات");
  });

  const shareBtn = document.createElement("button"); shareBtn.type = "button"; shareBtn.className = "action";
  shareBtn.innerHTML = `<span>➤</span><small>مشاركة</small>`;
  shareBtn.addEventListener("click", e => { e.stopPropagation(); openShareModal(post); });

  const dotsBtn = document.createElement("button"); dotsBtn.type = "button"; dotsBtn.className = "action more-dots-btn";
  dotsBtn.innerHTML = `<span>•••</span><small>المزيد</small>`;
  dotsBtn.addEventListener("click", e => { e.stopPropagation(); openPostOptions(post); });

  actions.append(likeBtn, commentBtn, saveBtn, shareBtn, dotsBtn);

  if (currentUser && post.user_id !== currentUser.id) {
    const isFollowing = followsCache.some(f => f.follower_id === currentUser.id && f.following_id === post.user_id);
    const followBtn = document.createElement("button"); followBtn.type = "button"; followBtn.dataset.userId = post.user_id;
    followBtn.className = "action follow-btn" + (isFollowing ? " following" : "");
    followBtn.innerHTML = `<span>${isFollowing ? "✓" : "＋"}</span><small>${isFollowing ? "تتابع" : "متابعة"}</small>`;
    followBtn.addEventListener("click", e => { e.stopPropagation(); toggleFollow(post.user_id); });
    actions.appendChild(followBtn);
  }
  slide.append(grad, info, actions);
  return slide;
}

function renderVideoFeed() {
  const feed = $("videoFeed"); if (feedObserver) feedObserver.disconnect(); feed.textContent = "";
  const visible = videosCache.filter(v => !isUserBlocked(v.user_id));
  if (!visible.length) {
    feed.innerHTML = `<div class="video-slide"><div class="video-placeholder"><div class="play-symbol">▶</div><span>مرحباً بك في DZ-CHAT</span><small>اضغط (+) لنشر صورة/فيديو أو فتح بث مباشر 🇩🇿</small></div><div class="video-gradient"></div></div>`;
    return;
  }
  visible.forEach(post => feed.appendChild(buildFeedSlide(post)));
  feedObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const vid = entry.target.querySelector("video"); if (!vid) return;
      if (entry.isIntersecting && $("homePage").classList.contains("active") && $("dzLiveRoom").hidden) vid.play().catch(() => {}); else vid.pause();
    });
  }, { root: feed, threshold: 0.65 });
  feed.querySelectorAll(".video-slide").forEach(slide => feedObserver.observe(slide));
}

function renderFriendsFeed() {
  if (!currentUser) return;
  const followingIds = new Set(followsCache.filter(f => f.follower_id === currentUser.id).map(f => f.following_id));
  const topAvs = $("friendsTopAvatars"); topAvs.textContent = "";
  [...followingIds].filter(id => !isUserBlocked(id)).slice(0, 3).map(id => profilesMap[id]).filter(Boolean).forEach(f => {
    const isLive = liveRoomsCache.some(r => r.host_id === f.id), av = document.createElement("button");
    av.type = "button"; av.className = "friends-mini-av" + (isLive ? " live" : "");
    setAvatarContent(av, f.avatar_url, f.username);
    av.onclick = () => { const lr = liveRoomsCache.find(r => r.host_id === f.id); if (lr) tryEnterLiveRoom(lr); else openUserProfile(f.id); };
    topAvs.appendChild(av);
  });

  const feed = $("friendsFeed"); if (friendsFeedObserver) friendsFeedObserver.disconnect(); feed.textContent = "";
  const friendPosts = videosCache.filter(v => followingIds.has(v.user_id) && !isUserBlocked(v.user_id));
  if (!friendPosts.length) {
    feed.innerHTML = `<div class="video-slide"><div class="video-placeholder"><div class="play-symbol">👥</div><span>منشورات أصدقائك</span><small>${followingIds.size ? "لم ينشر أصدقاؤك منشورات جديدة بعد." : "تابع أصدقاءك لتظهر كل منشوراتهم هنا!"}</small><button type="button" class="play-mini-btn" id="friendsFindBtn" style="margin-top:8px;">اكتشف أصدقاء للمتابعة 🔍</button></div><div class="video-gradient"></div></div>`;
    if ($("friendsFindBtn")) $("friendsFindBtn").addEventListener("click", openSearchModal);
    return;
  }
  friendPosts.forEach(post => feed.appendChild(buildFeedSlide(post)));
  friendsFeedObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const vid = entry.target.querySelector("video"); if (!vid) return;
      if (entry.isIntersecting && $("discoverPage").classList.contains("active") && $("dzLiveRoom").hidden) vid.play().catch(() => {}); else vid.pause();
    });
  }, { root: feed, threshold: 0.65 });
  feed.querySelectorAll(".video-slide").forEach(slide => friendsFeedObserver.observe(slide));
}

function openPostOptions(post) {
  activeOptionsPost = post;
  const isOwner = currentUser && post.user_id === currentUser.id;
  $("postOptEditBtn").hidden = !isOwner; $("postOptDeleteBtn").hidden = !isOwner;
  $("postOptSaveBtn").textContent = getSavedPostIds().includes(post.id) ? "🔖 إزالة من المحفوظات" : "🔖 حفظ في المحفوظات";
  $("dzPostOptionsModal").hidden = false;
}
$("dzClosePostOptions").addEventListener("click", () => { $("dzPostOptionsModal").hidden = true; });
$("dzPostOptionsModal").addEventListener("click", e => { if (e.target === $("dzPostOptionsModal")) $("dzPostOptionsModal").hidden = true; });
$("postOptSaveBtn").addEventListener("click", () => {
  if (!activeOptionsPost) return;
  const saved = toggleSavedPostId(activeOptionsPost.id); $("dzPostOptionsModal").hidden = true;
  renderProfile(); showToast(saved ? "تم حفظ المنشور في المحفوظات 🔖" : "تمت الإزالة من المحفوظات");
});
$("postOptCopyBtn").addEventListener("click", async () => {
  if (!activeOptionsPost) return;
  try { await navigator.clipboard.writeText(activeOptionsPost.video_url || ""); } catch {}
  $("dzPostOptionsModal").hidden = true; showToast("تم نسخ رابط المنشور 🔗");
});
$("postOptDeleteBtn").addEventListener("click", async () => {
  if (!activeOptionsPost || !confirm("هل تريد حذف هذا المنشور نهائياً؟")) return;
  const { error } = await db.from("videos").delete().eq("id", activeOptionsPost.id);
  $("dzPostOptionsModal").hidden = true;
  if (error) showToast("تعذر الحذف: " + error.message); else { await refreshAllData(true); showToast("تم حذف المنشور 🗑️"); }
});

$("postOptEditBtn").addEventListener("click", () => {
  if (!activeOptionsPost) return;
  $("dzPostOptionsModal").hidden = true; activeEditPost = activeOptionsPost; editPostMediaFile = null; editPostMediaType = null;
  $("editPostMediaFile").value = ""; $("editPostStatus").textContent = ""; $("editPostCaption").value = activeEditPost.caption || "";
  const prev = $("editPostPreview"); prev.textContent = "";
  const ms = safeUrl(activeEditPost.video_url, false);
  if (isImagePost(activeEditPost)) { const img = document.createElement("img"); img.src = ms; prev.appendChild(img); }
  else { const vid = document.createElement("video"); vid.src = ms; vid.controls = true; vid.playsInline = true; prev.appendChild(vid); }
  prev.hidden = false; $("dzEditPostModal").hidden = false;
});
$("dzCloseEditPost").addEventListener("click", () => { $("dzEditPostModal").hidden = true; });
$("dzEditPostModal").addEventListener("click", e => { if (e.target === $("dzEditPostModal")) $("dzEditPostModal").hidden = true; });
$("editPostMediaFile").addEventListener("change", e => {
  const file = e.target.files[0]; if (!file) return;
  const kind = isSafeVideoOrImageFile(file, 50);
  if (!kind) { e.target.value = ""; return; }
  editPostMediaFile = file; editPostMediaType = kind;
  $("editPostStatus").textContent = "تم اختيار ملف جديد: " + file.name;
  const prev = $("editPostPreview"); prev.textContent = ""; const url = URL.createObjectURL(file);
  if (kind === "image") { const img = document.createElement("img"); img.src = url; prev.appendChild(img); }
  else { const vid = document.createElement("video"); vid.src = url; vid.controls = true; vid.playsInline = true; prev.appendChild(vid); }
  prev.hidden = false;
});
$("saveEditPostBtn").addEventListener("click", async () => {
  if (!activeEditPost || !currentUser || !checkRateLimit("editPost", 1000)) return;
  const btn = $("saveEditPostBtn"), newCaption = cleanText($("editPostCaption").value, 300) || "منشور من DZ-CHAT 🇩🇿";
  btn.disabled = true; btn.textContent = "جارٍ الحفظ...";
  try {
    let videoUrl = activeEditPost.video_url, mediaType = activeEditPost.media_type;
    if (editPostMediaFile) {
      const ext = editPostMediaFile.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || (editPostMediaType === "image" ? "jpg" : "mp4");
      const path = `${currentUser.id}/${editPostMediaType}_${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(path, editPostMediaFile, { contentType: editPostMediaFile.type });
      if (upErr) throw upErr;
      videoUrl = db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl; mediaType = editPostMediaType;
    }
    const { error } = await db.from("videos").update({ caption: newCaption, video_url: videoUrl, media_type: mediaType }).eq("id", activeEditPost.id);
    if (error) throw error;
    $("dzEditPostModal").hidden = true; await refreshAllData(true); showToast("تم تعديل المنشور بنجاح ✅");
  } catch (err) { alert("تعذر تعديل المنشور:\n" + (err.message || err)); }
  finally { btn.disabled = false; btn.textContent = "حفظ التعديلات ✅"; }
});

function updatePostCountsInPlace(videoId) {
  document.querySelectorAll(`[data-video-id="${videoId}"]`).forEach(slide => {
    const vl = likesCache.filter(l => l.video_id === videoId), liked = currentUser && vl.some(l => l.user_id === currentUser.id);
    const lb = slide.querySelector(".like-btn"); if (lb) { lb.classList.toggle("liked", !!liked); lb.querySelector("small").textContent = formatCount(vl.length); }
    const cb = slide.querySelector(".comment-btn"); if (cb) cb.querySelector("small").textContent = commentsCache.filter(c => c.video_id === videoId).length;
  });
}

async function toggleLike(videoId) {
  if (!currentUser || !checkRateLimit("like", 250)) return;
  const exists = likesCache.some(l => l.video_id === videoId && l.user_id === currentUser.id);
  try {
    if (exists) {
      const { error } = await db.from("video_likes").delete().match({ video_id: videoId, user_id: currentUser.id }); if (error) throw error;
      likesCache = likesCache.filter(l => !(l.video_id === videoId && l.user_id === currentUser.id));
    } else {
      const { error } = await db.from("video_likes").insert({ video_id: videoId, user_id: currentUser.id }); if (error) throw error;
      likesCache.push({ video_id: videoId, user_id: currentUser.id });
    }
    updatePostCountsInPlace(videoId); renderProfile();
    if (!$("dzUserProfileModal").hidden && viewedUserProfileId) renderViewedUserProfile();
  } catch (err) { showToast("تعذر الإعجاب: " + err.message); }
}

async function toggleFollow(targetUserId) {
  if (!currentUser || targetUserId === currentUser.id || !checkRateLimit("follow", 350)) return;
  const exists = followsCache.some(f => f.follower_id === currentUser.id && f.following_id === targetUserId);
  try {
    if (exists) {
      const { error } = await db.from("follows").delete().match({ follower_id: currentUser.id, following_id: targetUserId }); if (error) throw error;
      followsCache = followsCache.filter(f => !(f.follower_id === currentUser.id && f.following_id === targetUserId));
    } else {
      const { error } = await db.from("follows").insert({ follower_id: currentUser.id, following_id: targetUserId }); if (error) throw error;
      followsCache.push({ follower_id: currentUser.id, following_id: targetUserId });
    }
    const nowF = !exists;
    document.querySelectorAll(`.follow-btn[data-user-id="${targetUserId}"]`).forEach(btn => {
      btn.classList.toggle("following", nowF);
      btn.querySelector("span").textContent = nowF ? "✓" : "＋";
      btn.querySelector("small").textContent = nowF ? "تتابع" : "متابعة";
    });
    renderProfile(); renderFriendsFeed();
    if (!$("dzFollowsModal").hidden) renderFollowsList();
    if (!$("dzUserProfileModal").hidden && viewedUserProfileId) renderViewedUserProfile();
  } catch (err) { showToast("تعذر المتابعة: " + err.message); }
}

async function openComments(videoId) {
  activeCommentVideoId = videoId; $("dzCommentsModal").hidden = false;
  const list = $("commentsList"); list.innerHTML = `<p style="text-align:center;color:#64748b;font-size:13px">جارٍ التحميل...</p>`;
  const { data, error } = await db.from("video_comments").select("*").eq("video_id", videoId).order("created_at", { ascending: true });
  if (error) { list.innerHTML = `<div class="modal-error"></div>`; list.querySelector(".modal-error").textContent = error.message; return; }
  list.textContent = "";
  if (!data.length) { list.innerHTML = `<p style="text-align:center;color:#64748b;font-size:13px;padding:12px 0">لا توجد تعليقات بعد.</p>`; return; }
  data.forEach(c => {
    const item = document.createElement("div"); item.className = "comment-item";
    const author = document.createElement("strong"); author.textContent = "@" + (profilesMap[c.user_id]?.username || "user");
    author.onclick = () => { $("dzCommentsModal").hidden = true; openUserProfile(c.user_id); };
    const body = document.createElement("span"); body.textContent = c.content;
    item.append(author, body); list.appendChild(item);
  });
  list.scrollTop = list.scrollHeight;
}
$("dzCloseComments").addEventListener("click", () => { activeCommentVideoId = null; $("dzCommentsModal").hidden = true; });
$("dzCommentsModal").addEventListener("click", e => { if (e.target === $("dzCommentsModal")) { activeCommentVideoId = null; $("dzCommentsModal").hidden = true; } });
$("commentForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!currentUser || !activeCommentVideoId) return;
  const content = cleanText($("commentInput").value, 300); if (!content || !checkRateLimit("comment", 400)) return;
  const btn = e.submitter; btn.disabled = true;
  try {
    const { data, error } = await db.from("video_comments").insert({ video_id: activeCommentVideoId, user_id: currentUser.id, content }).select().single();
    if (error) throw error;
    if (!commentsCache.some(c => c.id === data.id)) commentsCache.push({ id: data.id, video_id: activeCommentVideoId });
    $("commentInput").value = ""; await openComments(activeCommentVideoId); updatePostCountsInPlace(activeCommentVideoId);
  } catch (err) { showToast("فشل إرسال التعليق: " + err.message); }
  finally { btn.disabled = false; }
});

function openShareModal(post) {
  activeSharePost = post;
  const select = $("shareFriendSelect"); select.textContent = "";
  const friends = Object.values(profilesMap).filter(p => currentUser && p.id !== currentUser.id && !isUserBlocked(p.id));
  if (!friends.length) { const o = document.createElement("option"); o.value = ""; o.textContent = "لا يوجد أصدقاء بعد"; select.appendChild(o); }
  else friends.forEach(f => { const o = document.createElement("option"); o.value = f.id; o.textContent = "@" + f.username; select.appendChild(o); });
  $("shareLinkInput").value = post.video_url || ""; $("dzShareModal").hidden = false;
}
$("dzCloseShare").addEventListener("click", () => { $("dzShareModal").hidden = true; });
$("dzShareModal").addEventListener("click", e => { if (e.target === $("dzShareModal")) $("dzShareModal").hidden = true; });

async function sendPostToChat(receiverId) {
  if (!currentUser || !activeSharePost || !checkRateLimit("shareChat", 500)) return;
  const cn = profilesMap[activeSharePost.user_id]?.username || "user";
  const payload = JSON.stringify({ dz_share: true, type: isImagePost(activeSharePost) ? "image" : "video", creator: cn, caption: activeSharePost.caption || "", url: activeSharePost.video_url });
  const { error } = await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: receiverId, content: payload });
  if (error) { showToast("تعذرت المشاركة: " + error.message); return; }
  $("dzShareModal").hidden = true; openPrivateChat(receiverId); showToast("تمت مشاركة المنشور في الشات 💬");
}
$("shareToPublicBtn").addEventListener("click", () => sendPostToChat(null));
$("shareToFriendBtn").addEventListener("click", () => { const id = $("shareFriendSelect").value; if (id) sendPostToChat(id); });
$("shareExternalBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(activeSharePost?.video_url || ""); } catch {}
  $("dzShareModal").hidden = true; showToast("تم نسخ رابط المنشور 🔗");
});

$("videoFile").addEventListener("change", event => {
  const file = event.target.files[0]; if (!file) return;
  const kind = isSafeVideoOrImageFile(file, 50);
  if (!kind) { event.target.value = ""; return; }
  selectedMedia = file; selectedMediaType = kind;
  $("uploadStatus").textContent = `تم اختيار ${kind === "image" ? "الصورة" : "الفيديو"}: ${file.name}`;
  const prev = $("uploadPreview"); prev.textContent = ""; const url = URL.createObjectURL(file);
  if (kind === "image") { const img = document.createElement("img"); img.src = url; prev.appendChild(img); }
  else { const vid = document.createElement("video"); vid.src = url; vid.controls = true; vid.playsInline = true; prev.appendChild(vid); }
  prev.hidden = false;
});
$("publishBtn").addEventListener("click", async () => {
  if (!currentUser || !selectedMedia) { showToast("اختر صورة أو فيديو أولاً"); return; }
  if (!checkRateLimit("publish", 1500)) return;
  const btn = $("publishBtn"); btn.disabled = true; btn.textContent = "جارٍ النشر...";
  try {
    const ext = selectedMedia.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || (selectedMediaType === "image" ? "jpg" : "mp4");
    const filePath = `${currentUser.id}/${selectedMediaType}_${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(filePath, selectedMedia, { contentType: selectedMedia.type });
    if (upErr) throw upErr;
    const { data: pub } = db.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    const caption = cleanText($("newCaption").value, 300) || "منشور جديد من DZ-CHAT 🇩🇿";
    const { error: dbErr } = await db.from("videos").insert({ user_id: currentUser.id, video_url: pub.publicUrl, caption, media_type: selectedMediaType });
    if (dbErr) throw dbErr;
    selectedMedia = null; $("videoFile").value = ""; $("newCaption").value = ""; $("uploadStatus").textContent = ""; $("uploadPreview").hidden = true;
    await refreshAllData(true); switchPage("homePage"); $("videoFeed").scrollTo({ top: 0, behavior: "smooth" });
    showToast("تم نشر منشورك لجميع أصدقائك 🇩🇿");
  } catch (err) { alert("فشل النشر: " + err.message); }
  finally { btn.disabled = false; btn.textContent = "نشر الآن"; }
});
$("inboxOpenDiscoverBtn").addEventListener("click", openSearchModal);
$("inboxSearchBtn").addEventListener("click", openSearchModal);
$("inboxStatusToggle").addEventListener("click", async () => {
  showOnlineStatus = !showOnlineStatus; $("myStatusDot").classList.toggle("off", !showOnlineStatus);
  if (presenceChannel && currentUser) await presenceChannel.track({ user_id: currentUser.id, active: showOnlineStatus });
  showToast(showOnlineStatus ? "حالة النشاط مفعلة 🟢" : "حالة النشاط مخفية");
});

function renderInbox() {
  if (!currentUser) return;
  const miniStack = $("inboxMiniStack"); miniStack.textContent = "";
  Object.values(profilesMap).filter(p => p.id !== currentUser.id && !isUserBlocked(p.id) && (liveRoomsCache.some(r => r.host_id === p.id) || onlineUserIds.has(p.id))).slice(0, 2).forEach(p => {
    const isLive = liveRoomsCache.some(r => r.host_id === p.id), av = document.createElement("div");
    av.className = "friends-mini-av" + (isLive ? " live" : ""); setAvatarContent(av, p.avatar_url, p.username); miniStack.appendChild(av);
  });

  const strip = $("inboxStoriesStrip"); strip.textContent = "";
  const myItem = document.createElement("button"); myItem.type = "button"; myItem.className = "story-item";
  const bubble = document.createElement("span"); bubble.className = "story-bubble-note"; bubble.textContent = getUserThought() || "تحدث عن ما جرى";
  const myRing = document.createElement("div"); myRing.className = "story-ring";
  const myInner = document.createElement("div"); myInner.className = "story-avatar-inner"; setAvatarContent(myInner, currentProfile?.avatar_url, "حسابي");
  const plus = document.createElement("span"); plus.className = "story-plus-badge"; plus.textContent = "＋";
  myRing.append(myInner, plus);
  const myName = document.createElement("span"); myName.className = "story-name"; myName.textContent = "إنشاء";
  myItem.append(bubble, myRing, myName);
  myItem.onclick = () => { $("dzThoughtInput").value = getUserThought(); $("dzThoughtModal").hidden = false; };
  strip.appendChild(myItem);

  const liveHostIds = new Set();
  liveRoomsCache.forEach(room => {
    if (isUserBlocked(room.host_id)) return;
    liveHostIds.add(room.host_id);
    const host = profilesMap[room.host_id] || { id: room.host_id, username: "مضيف" };
    const item = document.createElement("button"); item.type = "button"; item.className = "story-item";
    const ring = document.createElement("div"); ring.className = "story-ring live-ring";
    const inner = document.createElement("div"); inner.className = "story-avatar-inner"; setAvatarContent(inner, host.avatar_url, host.username);
    const badge = document.createElement("span"); badge.className = "story-live-badge"; badge.textContent = "LIVE |ı|";
    ring.append(inner, badge);
    const nm = document.createElement("span"); nm.className = "story-name"; nm.textContent = host.username || "بث مباشر";
    item.append(ring, nm); item.onclick = () => tryEnterLiveRoom(room); strip.appendChild(item);
  });

  Object.values(profilesMap).forEach(p => {
    if (p.id === currentUser.id || liveHostIds.has(p.id) || isUserBlocked(p.id)) return;
    const isOn = onlineUserIds.has(p.id), item = document.createElement("button"); item.type = "button"; item.className = "story-item";
    const ring = document.createElement("div"); ring.className = "story-ring" + (isOn ? " online-ring" : "");
    const inner = document.createElement("div"); inner.className = "story-avatar-inner"; setAvatarContent(inner, p.avatar_url, p.username);
    ring.appendChild(inner); if (isOn) { const dot = document.createElement("span"); dot.className = "online-dot-badge"; ring.appendChild(dot); }
    const nm = document.createElement("span"); nm.className = "story-name"; nm.textContent = p.username || "صديق";
    item.append(ring, nm); item.onclick = () => openPrivateChat(p.id); strip.appendChild(item);
  });

  const list = $("inboxChatsList"); list.textContent = "";
  const others = Object.values(profilesMap).filter(p => p.id !== currentUser.id), lastMap = {};
  allMessagesCache.forEach(m => {
    if (m.receiver_id === null) return;
    const oid = m.sender_id === currentUser.id ? m.receiver_id : m.sender_id;
    if (!lastMap[oid]) lastMap[oid] = m;
  });

  let totalUnreadMsgs = 0;
  others.forEach(f => { totalUnreadMsgs += getUnreadCountForPeer(f.id); });

  const actCount = getUnreadActivityCount();
  const totalBadge = totalUnreadMsgs + actCount;
  if ($("inboxNavBadge")) {
    $("inboxNavBadge").hidden = totalBadge === 0;
    $("inboxNavBadge").textContent = totalBadge > 99 ? "99+" : String(totalBadge);
  }

  const actRow = document.createElement("button"); actRow.type = "button"; actRow.className = "inbox-row";
  actRow.innerHTML = `<div class="inbox-row-main"><div class="inbox-avatar"><div class="inbox-avatar-inner pink-sys">⚡</div></div><div class="inbox-row-text"><strong>النشاط والمتابعون الجدد</strong><small>الإعجابات والمتابعات على منشوراتك</small></div></div><div class="inbox-row-side">${actCount > 0 ? `<span class="inbox-badge-red">${actCount}</span>` : ""}<span>‹</span></div>`;
  actRow.onclick = () => { markActivityAsRead(); openFollowsModal("followers"); }; list.appendChild(actRow);

  const pubRow = document.createElement("button"); pubRow.type = "button"; pubRow.className = "inbox-row";
  const lastPub = allMessagesCache.find(m => m.receiver_id === null);
  pubRow.innerHTML = `<div class="inbox-row-main"><div class="inbox-avatar"><div class="inbox-avatar-inner pub-sys">🌐</div></div><div class="inbox-row-text"><strong>شات الأصدقاء العام</strong><small></small></div></div><div class="inbox-row-side"><span>📷</span></div>`;
  pubRow.querySelector("small").textContent = lastPub ? formatMsgPreview(lastPub) : "محادثة مفتوحة للجميع";
  pubRow.onclick = () => openPrivateChat(null); list.appendChild(pubRow);

  others.sort((a, b) => {
    const ap = isUserPinned(a.id) ? 1 : 0, bp = isUserPinned(b.id) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const al = liveRoomsCache.some(r => r.host_id === a.id) ? 1 : 0, bl = liveRoomsCache.some(r => r.host_id === b.id) ? 1 : 0;
    if (al !== bl) return bl - al;
    return (lastMap[b.id]?.created_at ? new Date(lastMap[b.id].created_at).getTime() : 0) - (lastMap[a.id]?.created_at ? new Date(lastMap[a.id].created_at).getTime() : 0);
  });

  others.forEach(friend => {
    const last = lastMap[friend.id], liveRoom = liveRoomsCache.find(r => r.host_id === friend.id), isOn = onlineUserIds.has(friend.id);
    const unread = getUnreadCountForPeer(friend.id), blocked = isUserBlocked(friend.id), pinned = isUserPinned(friend.id);
    const row = document.createElement("div"); row.className = "inbox-row";
    const main = document.createElement("div"); main.className = "inbox-row-main";
    const av = document.createElement("div"); av.className = "inbox-avatar " + (liveRoom && !blocked ? "has-live" : (isOn && !blocked ? "has-online" : ""));
    const avIn = document.createElement("div"); avIn.className = "inbox-avatar-inner"; setAvatarContent(avIn, friend.avatar_url, friend.username); av.appendChild(avIn);
    if (liveRoom && !blocked) {
      const wv = document.createElement("span"); wv.className = "live-wave-badge"; wv.textContent = "|ı|"; av.appendChild(wv);
      av.onclick = e => { e.stopPropagation(); tryEnterLiveRoom(liveRoom); };
    } else {
      if (isOn && !blocked) { const dot = document.createElement("span"); dot.className = "online-dot-badge"; av.appendChild(dot); }
      av.onclick = e => { e.stopPropagation(); openUserProfile(friend.id); };
    }
    const txt = document.createElement("div"); txt.className = "inbox-row-text";
    const st = document.createElement("strong");
    st.textContent = (pinned ? "📌 " : "") + friend.username + (blocked ? " (محظور)" : "");
    if (unread > 0) st.classList.add("unread-bold");

    const sm = document.createElement("small");
    if (blocked) sm.textContent = "حساب محظور";
    else if (liveRoom) sm.textContent = "في بث مباشر الآن — اضغط الصورة للدخول";
    else if (last) {
      sm.textContent = (last.sender_id === currentUser.id ? "تم الإرسال: " + formatMsgPreview(last) : formatMsgPreview(last)) + " • " + formatRelTime(last.created_at);
      if (unread > 0) sm.classList.add("unread-sub");
    } else sm.textContent = "قل مرحبًا لـ " + friend.username;

    txt.append(st, sm); main.append(av, txt);
    const side = document.createElement("div"); side.className = "inbox-row-side";
    if (unread > 0) side.innerHTML = `<span class="inbox-badge-red">${unread}</span><span>📷</span>`;
    else side.innerHTML = `<span>📷</span>`;
    row.append(main, side); row.onclick = () => openPrivateChat(friend.id); list.appendChild(row);
  });
}

function formatMsgPreview(msg) {
  const p = parseMsgPayload(msg.content);
  if (p.kind === "image") return "📷 صورة";
  if (p.kind === "voice") return "🎙️ رسالة صوتية";
  if (p.kind === "share") return "🎬 مشاركة منشور";
  if (p.kind === "live") return "🔴 دعوة لبث مباشر";
  return p.text || "";
}

function refreshChatBlockedState() {
  if (activeChatUserId === "__none__" || activeChatUserId === null) {
    $("chatBlockedBanner").hidden = true; $("chatForm").hidden = false; $("chatQuickBar").hidden = false; return;
  }
  const blocked = isUserBlocked(activeChatUserId);
  $("chatBlockedBanner").hidden = !blocked;
  $("chatForm").hidden = blocked;
  $("chatQuickBar").hidden = blocked;
}

function openPrivateChat(targetUserId) {
  if (!currentUser) return;
  activeChatUserId = targetUserId;
  chatSearchQuery = ""; $("chatSearchBar").hidden = true; $("chatSearchInput").value = "";
  markChatAsRead(targetUserId, Date.now());
  renderInbox();

  if (targetUserId === null) {
    $("chatHeaderName").textContent = "شات الأصدقاء العام";
    $("chatHeaderSub").textContent = "مفتوح لجميع الأعضاء";
    setAvatarContent($("chatHeaderAvatar"), null, "العام");
  } else {
    const f = profilesMap[targetUserId] || {}, live = liveRoomsCache.find(r => r.host_id === targetUserId);
    $("chatHeaderName").textContent = f.username || "صديق";
    $("chatHeaderSub").textContent = isUserBlocked(targetUserId) ? "🚫 حساب محظور" : (live ? "🔴 في بث مباشر الآن" : (onlineUserIds.has(targetUserId) ? "🟢 نشط الآن" : (f.country || "غير متصل")));
    setAvatarContent($("chatHeaderAvatar"), f.avatar_url, f.username);
  }
  refreshChatBlockedState();
  $("chatEmojiBar").hidden = true; $("chatVoiceBar").hidden = true;
  $("chatSendBtn").hidden = false;
  $("dzChatRoom").hidden = false;
  loadMessages();
}

function closePrivateChat() {
  stopVoiceRecorder(false); activeChatUserId = "__none__"; $("dzChatRoom").hidden = true; $("dzChatSettingsModal").hidden = true;
}

$("chatBackBtn").addEventListener("click", closePrivateChat);
$("chatHeaderAvatar").addEventListener("click", () => { if (activeChatUserId && activeChatUserId !== "__none__") openUserProfile(activeChatUserId); });
$("chatHeaderUserMeta").addEventListener("click", () => { if (activeChatUserId && activeChatUserId !== "__none__") openUserProfile(activeChatUserId); });
$("chatCallBtn").addEventListener("click", () => {
  const live = activeChatUserId && liveRoomsCache.find(r => r.host_id === activeChatUserId);
  if (live) { closePrivateChat(); tryEnterLiveRoom(live); } else { closePrivateChat(); $("dzLiveSetupModal").hidden = false; }
});
$("chatUnblockQuickBtn").addEventListener("click", () => {
  if (activeChatUserId && activeChatUserId !== "__none__") {
    setUserChatPref(activeChatUserId, { blocked: false });
    refreshChatBlockedState(); renderInbox(); renderVideoFeed(); renderFriendsFeed();
    showToast("تم إلغاء حظر الحساب ✅");
  }
});

function openChatSettingsModal() {
  if (!currentUser || activeChatUserId === "__none__") return;
  if (activeChatUserId === null) {
    showToast("الشات العام مفتوح للجميع — اضغط مطولاً على أي رسالة للتعديل أو الحذف");
    return;
  }
  const f = profilesMap[activeChatUserId] || {}, prefs = getUserChatPrefs(activeChatUserId);
  setAvatarContent($("csAvatar"), f.avatar_url, f.username);
  $("csDisplayName").textContent = (f.username || "صديق").toUpperCase();
  $("csToggleNotifyAll").checked = !!prefs.notifyAll;
  $("csToggleMuteMsgs").checked = !!prefs.muteMsgs;
  $("csToggleMuteCalls").checked = !!prefs.muteCalls;
  $("csTogglePin").checked = !!prefs.pinned;
  $("csBlockAccountText").textContent = prefs.blocked ? "إلغاء حظر الحساب" : "حظر الحساب";
  $("dzChatSettingsModal").hidden = false;
}
$("chatMoreBtn").addEventListener("click", openChatSettingsModal);
$("csBackBtn").addEventListener("click", () => { $("dzChatSettingsModal").hidden = true; });
$("csMoreDotBtn").addEventListener("click", () => { $("dzChatSettingsModal").hidden = true; });
$("csSearchChatBtn").addEventListener("click", () => {
  $("dzChatSettingsModal").hidden = true; $("chatSearchBar").hidden = false; $("chatSearchInput").focus();
});
$("csViewProfileBtn").addEventListener("click", () => {
  const id = activeChatUserId; $("dzChatSettingsModal").hidden = true;
  if (id) openUserProfile(id);
});
$("csCreateGroupBtn").addEventListener("click", () => {
  $("dzChatSettingsModal").hidden = true; closePrivateChat(); $("dzLiveSetupModal").hidden = false;
});
$("csToggleNotifyAll").addEventListener("change", async e => {
  if (!activeChatUserId || activeChatUserId === "__none__") return;
  setUserChatPref(activeChatUserId, { notifyAll: e.target.checked });
  if (e.target.checked && "Notification" in window && Notification.permission === "default") {
    try { await Notification.requestPermission(); refreshNotifyBtnVisibility(); } catch {}
  }
  showToast(e.target.checked ? "تم تفعيل متابعة كل إشعارات الحساب 🔔" : "تم إيقاف متابعة إشعارات الحساب");
});
$("csToggleMuteMsgs").addEventListener("change", e => {
  if (!activeChatUserId || activeChatUserId === "__none__") return;
  setUserChatPref(activeChatUserId, { muteMsgs: e.target.checked });
  showToast(e.target.checked ? "تم حظر/كتم رسائل هذا الصديق 🔕" : "تم السماح بإشعارات الرسائل");
});
$("csToggleMuteCalls").addEventListener("change", e => {
  if (!activeChatUserId || activeChatUserId === "__none__") return;
  setUserChatPref(activeChatUserId, { muteCalls: e.target.checked });
  showToast(e.target.checked ? "تم كتم المكالمات والبث 📞" : "تم تفعيل إشعارات المكالمات");
});
$("csTogglePin").addEventListener("change", e => {
  if (!activeChatUserId || activeChatUserId === "__none__") return;
  setUserChatPref(activeChatUserId, { pinned: e.target.checked });
  renderInbox();
  showToast(e.target.checked ? "تم تثبيت المحادثة في الأعلى 📌" : "تم إلغاء التثبيت");
});
$("csBlockAccountBtn").addEventListener("click", () => {
  if (!activeChatUserId || activeChatUserId === "__none__") return;
  const f = profilesMap[activeChatUserId] || {}, currentlyBlocked = isUserBlocked(activeChatUserId);
  if (!currentlyBlocked && !confirm(`هل تريد حظر حساب @${f.username || "هذا المستخدم"}؟`)) return;
  const next = !currentlyBlocked;
  setUserChatPref(activeChatUserId, { blocked: next });
  $("csBlockAccountText").textContent = next ? "إلغاء حظر الحساب" : "حظر الحساب";
  refreshChatBlockedState();
  renderInbox(); renderVideoFeed(); renderFriendsFeed();
  $("dzChatSettingsModal").hidden = true;
  showToast(next ? "تم حظر الحساب 🚫" : "تم إلغاء حظر الحساب ✅");
});

$("chatSearchInput").addEventListener("input", () => { chatSearchQuery = $("chatSearchInput").value.trim().toLowerCase(); loadMessages(); });
$("chatSearchCloseBtn").addEventListener("click", () => { chatSearchQuery = ""; $("chatSearchInput").value = ""; $("chatSearchBar").hidden = true; loadMessages(); });

$("chatEmojiBtn").addEventListener("click", () => { $("chatEmojiBar").hidden = !$("chatEmojiBar").hidden; });
$("chatEmojiBar").addEventListener("click", e => {
  const btn = e.target.closest(".dm-emoji-item"); if (!btn) return;
  $("chatInput").value += btn.textContent; $("chatInput").focus();
});

$("chatQuickBar").addEventListener("click", async e => {
  const chip = e.target.closest(".dm-quick-chip"); if (!chip || activeChatUserId === "__none__") return;
  const q = chip.dataset.quick;
  if (q === "heart") await sendRawMessage("❤️");
  else if (q === "share") {
    if (videosCache.length) { activeSharePost = videosCache[0]; await sendPostToChat(activeChatUserId); }
    else showToast("لا توجد منشورات للمشاركة بعد");
  } else if (q === "reply") {
    const replies = ["السلام عليكم، واش راك؟ 🇩🇿", "الله يحفظك خويا العزيز ❤️", "راني داخل للبث الآن 🔥"];
    $("chatInput").value = replies[Math.floor(Math.random() * replies.length)]; $("chatInput").focus();
  }
});

$("chatGalleryBtn").addEventListener("click", () => $("chatImgInput").click());
$("chatCamBtn").addEventListener("click", () => $("chatCamInput").click());

async function handleChatImageUpload(e) {
  const file = e.target.files[0]; if (!file || !currentUser || activeChatUserId === "__none__") return;
  if (!isSafeImageFile(file, 8)) { e.target.value = ""; return; }
  showToast("جارٍ إرسال الصورة...");
  try {
    const ext = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${currentUser.id}/chat_${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type || "image/jpeg" });
    if (upErr) throw upErr;
    await sendRawMessage(JSON.stringify({ dz_img: true, url: db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl }));
  } catch (err) { showToast("فشل إرسال الصورة: " + err.message); }
  e.target.value = "";
}
$("chatImgInput").addEventListener("change", handleChatImageUpload);
$("chatCamInput").addEventListener("change", handleChatImageUpload);

$("chatMicBtn").addEventListener("click", async () => {
  if (activeChatUserId === "__none__" || !currentUser || (voiceRecorder && voiceRecorder.state === "recording")) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = []; voiceSeconds = 0;
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
    voiceMimeType = candidates.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || "";
    const opts = voiceMimeType ? { mimeType: voiceMimeType, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 };
    try { voiceRecorder = new MediaRecorder(stream, opts); } catch { voiceRecorder = voiceMimeType ? new MediaRecorder(stream, { mimeType: voiceMimeType }) : new MediaRecorder(stream); }
    voiceRecorder.ondataavailable = ev => { if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data); };
    voiceRecorder.start(250);
    $("chatVoiceTimer").textContent = "00:00"; $("chatVoiceBar").hidden = false;
    voiceTimerInt = setInterval(() => {
      voiceSeconds++;
      $("chatVoiceTimer").textContent = `${String(Math.floor(voiceSeconds / 60)).padStart(2, "0")}:${String(voiceSeconds % 60).padStart(2, "0")}`;
    }, 1000);
  } catch (err) { showToast("تعذر فتح الميكروفون: " + (err.message || "تحقق من الإذن")); }
});

async function uploadVoiceSafely(chunks, primaryMime) {
  const base = (primaryMime || "audio/webm").split(";")[0];
  const attempts = base.includes("mp4")
    ? [{ mime: "audio/mp4", ext: "m4a" }, { mime: "video/mp4", ext: "mp4" }]
    : [{ mime: "audio/webm", ext: "webm" }, { mime: "video/webm", ext: "webm" }];
  for (const att of attempts) {
    const blob = new Blob(chunks, { type: att.mime });
    const path = `${currentUser.id}/voice_${Date.now()}.${att.ext}`;
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, blob, { contentType: att.mime });
    if (!error) return db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    if (!/mime/i.test(error.message || "")) break;
  }
  return await blobToDataUrl(new Blob(chunks, { type: base }));
}

function stopVoiceRecorder(send) {
  clearInterval(voiceTimerInt);
  const finalDur = $("chatVoiceTimer") ? $("chatVoiceTimer").textContent : "00:01";
  if ($("chatVoiceBar")) $("chatVoiceBar").hidden = true;
  if (!voiceRecorder) return;
  const rec = voiceRecorder, targetChatId = activeChatUserId;
  voiceRecorder = null;

  rec.onstop = async () => {
    try { rec.stream.getTracks().forEach(t => t.stop()); } catch {}
    if (!send || !currentUser || targetChatId === "__none__") return;
    if (!voiceChunks.length) { showToast("التسجيل قصير جداً، تحدث أطول قليلاً"); return; }
    showToast("جارٍ إرسال الرسالة الصوتية...");
    try {
      const url = await uploadVoiceSafely(voiceChunks, rec.mimeType || voiceMimeType || "audio/webm");
      const { error: msgErr } = await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: targetChatId, content: JSON.stringify({ dz_voice: true, url, dur: finalDur }) });
      if (msgErr) throw msgErr;
      if (activeChatUserId === targetChatId) await loadMessages();
      refreshAllData(false);
    } catch (err) { alert("فشل إرسال الرسالة الصوتية:\n" + (err.message || err)); }
  };
  try { if (rec.state === "recording" && rec.requestData) rec.requestData(); if (rec.state !== "inactive") rec.stop(); } catch {}
}
$("chatVoiceCancelBtn").addEventListener("click", () => stopVoiceRecorder(false));
$("chatVoiceSendBtn").addEventListener("click", () => stopVoiceRecorder(true));

async function sendRawMessage(content) {
  if (!currentUser || activeChatUserId === "__none__" || !checkRateLimit("sendMsg", 250)) return;
  if (activeChatUserId !== null && isUserBlocked(activeChatUserId)) { showToast("هذا الحساب محظور"); return; }
  const targetId = activeChatUserId;
  const { error } = await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: targetId, content });
  if (error) {
    if (targetId === null) alert("تعذر الإرسال في الشات العام:\n" + error.message);
    else showToast("فشل الإرسال: " + error.message);
  } else { await loadMessages(); refreshAllData(false); }
}

$("chatForm").addEventListener("submit", async e => {
  e.preventDefault();
  const content = cleanText($("chatInput").value, 1000); if (!content) return;
  $("chatInput").value = "";
  await sendRawMessage(content);
});

function openMsgActionModal(msg, parsed, isMine) {
  activeActionMsg = msg;
  activeActionMsgParsed = parsed;
  const canEdit = isMine && parsed.kind === "text";
  $("msgEditSection").hidden = !canEdit;
  if (canEdit) $("msgEditInput").value = parsed.text || "";
  $("msgCopyBtn").hidden = parsed.kind !== "text";
  $("msgDeleteBtn").hidden = !isMine;
  $("dzMsgActionModal").hidden = false;
}
$("msgActionCloseBtn").addEventListener("click", () => { $("dzMsgActionModal").hidden = true; });
$("dzMsgActionModal").addEventListener("click", e => { if (e.target === $("dzMsgActionModal")) $("dzMsgActionModal").hidden = true; });

$("msgReactBar").addEventListener("click", async e => {
  const btn = e.target.closest("button[data-react]"); if (!btn || !activeActionMsg) return;
  const emoji = btn.dataset.react, p = activeActionMsgParsed;
  const nr = p.react === emoji ? "" : emoji;
  let uc = null;
  if (p.kind === "text") uc = JSON.stringify({ dz_txt: true, text: p.text, react: nr, edited: !!p.edited });
  else if (p.kind === "image") uc = JSON.stringify({ dz_img: true, url: p.url, react: nr });
  else if (p.kind === "voice") uc = JSON.stringify({ dz_voice: true, url: p.url, dur: p.dur, react: nr });
  $("dzMsgActionModal").hidden = true;
  if (!uc) return;
  const { error } = await db.from("messages").update({ content: uc }).eq("id", activeActionMsg.id);
  if (error) showToast("لتفعيل التفاعل فعّل UPDATE لجدول messages في Supabase");
  else await loadMessages();
});

$("msgEditSaveBtn").addEventListener("click", async () => {
  if (!activeActionMsg || activeActionMsgParsed?.kind !== "text") return;
  const newText = cleanText($("msgEditInput").value, 1000); if (!newText) return;
  const uc = JSON.stringify({ dz_txt: true, text: newText, react: activeActionMsgParsed.react || "", edited: true });
  const { error } = await db.from("messages").update({ content: uc }).eq("id", activeActionMsg.id);
  $("dzMsgActionModal").hidden = true;
  if (error) showToast("لتعديل الرسالة فعّل UPDATE لجدول messages في Supabase");
  else { showToast("تم تعديل الرسالة ✅"); await loadMessages(); refreshAllData(false); }
});

$("msgCopyBtn").addEventListener("click", async () => {
  if (activeActionMsgParsed?.text) { try { await navigator.clipboard.writeText(activeActionMsgParsed.text); } catch {} }
  $("dzMsgActionModal").hidden = true;
  showToast("تم نسخ النص 📋");
});

$("msgDeleteBtn").addEventListener("click", async () => {
  if (!activeActionMsg) return;
  const { error } = await db.from("messages").delete().eq("id", activeActionMsg.id);
  $("dzMsgActionModal").hidden = true;
  if (error) showToast("لتفعيل الحذف فعّل DELETE لجدول messages في Supabase");
  else { showToast("تم حذف الرسالة 🗑️"); await loadMessages(); refreshAllData(false); }
});

async function loadMessages() {
  if (!currentUser || activeChatUserId === "__none__") return;
  const reqId = activeChatUserId, box = $("chatMessages");
  let query = db.from("messages").select("*").order("created_at", { ascending: true }).limit(120);
  if (reqId === null) query = query.is("receiver_id", null);
  else query = query.or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${reqId}),and(sender_id.eq.${reqId},receiver_id.eq.${currentUser.id})`);
  const { data, error } = await query;
  if (activeChatUserId !== reqId) return;
  if (error) { showToast("تعذر تحميل الرسائل: " + error.message); return; }

  const latestTs = (data && data.length) ? new Date(data[data.length - 1].created_at).getTime() : Date.now();
  markChatAsRead(reqId, Math.max(Date.now(), latestTs));
  renderInbox();

  box.textContent = "";
  const filtered = (data || []).filter(m => {
    if (reqId === null && isUserBlocked(m.sender_id)) return false;
    if (!chatSearchQuery) return true;
    return formatMsgPreview(m).toLowerCase().includes(chatSearchQuery);
  });

  if (!filtered.length) {
    box.innerHTML = `<div class="dm-sys-notice">${chatSearchQuery ? "لا توجد رسائل مطابقة للبحث." : "لا توجد رسائل بعد. قل مرحباً! 👋"}</div>`;
    return;
  }

  filtered.forEach(m => {
    const isMine = m.sender_id === currentUser.id, row = document.createElement("div");
    row.className = "dm-row " + (isMine ? "mine" : "theirs");
    if (!isMine) {
      const av = document.createElement("div"); av.className = "dm-mini-av";
      setAvatarContent(av, profilesMap[m.sender_id]?.avatar_url, "صديق");
      av.onclick = () => openUserProfile(m.sender_id); row.appendChild(av);
    }
    const wrap = document.createElement("div"); wrap.className = "dm-bubble-wrap";
    const parsed = parseMsgPayload(m.content);
    if (reqId === null && !isMine && parsed.kind !== "text") {
      const tag = document.createElement("span"); tag.className = "dm-sender-tag";
      tag.textContent = "@" + (profilesMap[m.sender_id]?.username || "عضو"); wrap.appendChild(tag);
    }
    if (parsed.kind === "live") {
      const card = document.createElement("div"); card.className = "dm-live-invite";
      const t = document.createElement("strong"); t.textContent = `🔴 دعوة لبث @${parsed.hostName}`;
      const s = document.createElement("small"); s.textContent = parsed.title || "بث مباشر الآن";
      const jb = document.createElement("button"); jb.type = "button"; jb.textContent = "دخول البث الآن";
      jb.onclick = async () => {
        const f = liveRoomsCache.find(r => r.id === parsed.roomId);
        if (f) { closePrivateChat(); tryEnterLiveRoom(f); return; }
        const { data: rd } = await db.from("live_rooms").select("*").eq("id", parsed.roomId).eq("is_active", true).maybeSingle();
        if (rd) { closePrivateChat(); tryEnterLiveRoom(rd); } else showToast("هذا البث المباشر قد انتهى");
      };
      card.append(t, s, jb); wrap.appendChild(card);
    } else if (parsed.kind === "share") {
      const card = document.createElement("div"); card.className = "shared-card";
      const by = document.createElement("small"); by.textContent = "📤 منشور @" + parsed.creator; card.appendChild(by);
      const su = safeUrl(parsed.url, false);
      if (parsed.type === "image") { const img = document.createElement("img"); img.src = su; card.appendChild(img); }
      else { const vid = document.createElement("video"); vid.src = su; vid.controls = true; vid.playsInline = true; card.appendChild(vid); }
      if (parsed.caption) { const cap = document.createElement("p"); cap.textContent = parsed.caption; card.appendChild(cap); }
      wrap.appendChild(card);
    } else if (parsed.kind === "image") {
      const img = document.createElement("img"); img.className = "dm-img-msg"; img.src = safeUrl(parsed.url, true); wrap.appendChild(img);
    } else if (parsed.kind === "voice") {
      const b = document.createElement("div"); b.className = "dm-bubble";
      const aud = document.createElement("audio"); aud.className = "dm-audio-msg"; aud.controls = true; aud.preload = "metadata"; aud.src = safeUrl(parsed.url, true);
      b.appendChild(aud); wrap.appendChild(b);
    } else {
      const b = document.createElement("div"); b.className = "dm-bubble";
      if (reqId === null && !isMine) {
        const tag = document.createElement("span"); tag.className = "dm-sender-tag";
        tag.textContent = "@" + (profilesMap[m.sender_id]?.username || "عضو"); b.appendChild(tag);
      }
      const sp = document.createElement("span"); sp.textContent = parsed.text; b.appendChild(sp);
      if (parsed.edited) {
        const ed = document.createElement("span"); ed.className = "dm-edited-tag"; ed.textContent = "(معدلة)"; b.appendChild(ed);
      }
      wrap.appendChild(b);
    }

    if (parsed.react) { const rp = document.createElement("span"); rp.className = "dm-react-pill"; rp.textContent = parsed.react; wrap.appendChild(rp); }

    attachLongPress(wrap, () => openMsgActionModal(m, parsed, isMine));
    row.appendChild(wrap); box.appendChild(row);
  });
  box.scrollTop = box.scrollHeight;
}
function subscribeRealtimeAll() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = db.channel("dz-chat-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, async payload => {
      const msg = payload.new; if (!currentUser) return;
      if (msg?.sender_id && !profilesMap[msg.sender_id]) {
        const { data } = await db.from("profiles").select("*").eq("id", msg.sender_id).maybeSingle();
        if (data) profilesMap[data.id] = data;
      }
      if (payload.eventType === "INSERT" && msg && msg.sender_id && msg.sender_id !== currentUser.id) {
        const isPrivateForMe = msg.receiver_id === currentUser.id;
        const viewingThisSender = activeChatUserId === msg.sender_id;
        const blockedOrMuted = isUserMsgMuted(msg.sender_id);

        if (isPrivateForMe && !viewingThisSender && !blockedOrMuted) {
          showTopMessageNotification(profilesMap[msg.sender_id], formatMsgPreview(msg), msg.sender_id);
        } else if (msg.receiver_id === null && activeChatUserId !== null && !isUserBlocked(msg.sender_id)) {
          showTopMessageNotification(profilesMap[msg.sender_id], "في الشات العام: " + formatMsgPreview(msg), null);
        }
      }
      if (activeChatUserId !== "__none__") await loadMessages();
      await refreshAllData(false);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "video_likes" }, async payload => {
      const { data } = await db.from("video_likes").select("video_id, user_id"); if (data) likesCache = data;
      const vid = payload.new?.video_id || payload.old?.video_id; if (vid) updatePostCountsInPlace(vid);
      renderProfile(); renderInbox();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "video_comments" }, async payload => {
      const { data } = await db.from("video_comments").select("id, video_id"); if (data) commentsCache = data;
      const vid = payload.new?.video_id; if (vid) updatePostCountsInPlace(vid);
      if (activeCommentVideoId && activeCommentVideoId === vid) await openComments(activeCommentVideoId);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "follows" }, async payload => {
      const { data } = await db.from("follows").select("follower_id, following_id"); if (data) followsCache = data;
      if (payload.eventType === "INSERT" && currentUser && payload.new?.following_id === currentUser.id) {
        const fid = payload.new.follower_id;
        if (fid && !profilesMap[fid]) {
          const { data: fp } = await db.from("profiles").select("*").eq("id", fid).maybeSingle();
          if (fp) profilesMap[fp.id] = fp;
        }
        if (!isUserBlocked(fid)) {
          playMsgNotificationSound();
          showToast(`👤 بدأ @${profilesMap[fid]?.username || "عضو"} بمتابعتك!`);
        }
      }
      renderProfile(); renderInbox();
      if (!$("dzFollowsModal").hidden) renderFollowsList();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "videos" }, async payload => {
      await refreshAllData(true);
      if (payload.eventType === "INSERT" && currentUser && payload.new?.user_id && payload.new.user_id !== currentUser.id && isUserNotifyAll(payload.new.user_id)) {
        const author = profilesMap[payload.new.user_id];
        playMsgNotificationSound();
        showToast(`🔔 نشر @${author?.username || "صديق"} منشوراً جديداً!`);
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "live_rooms" }, async () => {
      const { data } = await db.from("live_rooms").select("*").eq("is_active", true).order("created_at", { ascending: false });
      liveRoomsCache = data || [];
      const activeIds = new Set(liveRoomsCache.map(r => r.id));
      for (const id of [...knownLiveRoomIds]) { if (!activeIds.has(id)) knownLiveRoomIds.delete(id); }
      for (const r of liveRoomsCache) {
        if (!knownLiveRoomIds.has(r.id)) {
          knownLiveRoomIds.add(r.id);
          const isBanned = currentUser && parseRoomMeta(r.title).bl.includes(currentUser.id);
          if (currentUser && r.host_id && r.host_id !== currentUser.id && !isUserCallMuted(r.host_id) && !isBanned) {
            if (!profilesMap[r.host_id]) {
              const { data: hp } = await db.from("profiles").select("*").eq("id", r.host_id).maybeSingle();
              if (hp) profilesMap[hp.id] = hp;
            }
            showTopLiveNotification(profilesMap[r.host_id], r);
          }
        }
      }
      renderLiveRoomsStrip(); renderInbox(); renderFriendsFeed();
      if (!$("dzUserProfileModal").hidden && viewedUserProfileId) renderViewedUserProfile();
    })
    .subscribe();
}

function openSearchModal() { $("dzSearchModal").hidden = false; renderDiscoverSearch(); $("searchInput").focus(); }
$("searchBtn").addEventListener("click", openSearchModal);
$("friendsSearchOpenBtn").addEventListener("click", openSearchModal);
$("searchCloseBtn").addEventListener("click", () => { $("dzSearchModal").hidden = true; });

function renderDiscoverSearch() {
  const q = $("searchInput").value.trim().toLowerCase(), container = $("discoverResults"); container.textContent = "";
  const mu = Object.values(profilesMap).filter(p => currentUser && p.id !== currentUser.id && (p.username || "").toLowerCase().includes(q));
  const mv = videosCache.filter(v => !isUserBlocked(v.user_id) && ((profilesMap[v.user_id]?.username || "").toLowerCase().includes(q) || (v.caption || "").toLowerCase().includes(q)));
  if (!mu.length && !mv.length) { container.innerHTML = `<div class="discover-box"><div>🇩🇿</div><h3>لا توجد نتائج</h3></div>`; return; }
  mu.forEach(user => {
    const row = document.createElement("div"); row.className = "discover-item";
    const info = document.createElement("div"); info.style.cursor = "pointer"; info.style.flex = "1";
    info.innerHTML = `<strong></strong><small></small>`; info.querySelector("strong").textContent = "@" + user.username; info.querySelector("small").textContent = user.country || "الجزائر";
    info.onclick = () => { $("dzSearchModal").hidden = true; openUserProfile(user.id); };
    const cb = document.createElement("button"); cb.type = "button"; cb.className = "play-mini-btn"; cb.textContent = "مراسلة 💬";
    cb.onclick = () => { $("dzSearchModal").hidden = true; openPrivateChat(user.id); };
    row.append(info, cb); container.appendChild(row);
  });
  mv.forEach(post => {
    const uname = profilesMap[post.user_id]?.username || "user", row = document.createElement("div"); row.className = "discover-item";
    const info = document.createElement("div"), st = document.createElement("strong"), sm = document.createElement("small");
    st.textContent = `${isImagePost(post) ? "🖼️" : "🎬"} @${uname}`; sm.textContent = post.caption; info.append(st, sm);
    const pb = document.createElement("button"); pb.type = "button"; pb.className = "play-mini-btn"; pb.textContent = "مشاهدة";
    pb.onclick = () => { $("dzSearchModal").hidden = true; switchPage("homePage"); const t = $("videoFeed").querySelector(`[data-video-id="${post.id}"]`); if (t) t.scrollIntoView({ behavior: "smooth" }); };
    row.append(info, pb); container.appendChild(row);
  });
}
$("searchInput").addEventListener("input", renderDiscoverSearch);

function openUserProfile(userId) {
  if (!currentUser || !userId) return;
  if (userId === currentUser.id) { closePrivateChat(); switchPage("profilePage"); return; }
  viewedUserProfileId = userId; viewedUserProfileTab = "posts";
  $("userProfTabs").querySelectorAll(".profile-tab").forEach(t => t.classList.toggle("active", t.dataset.utab === "posts"));
  renderViewedUserProfile(); $("dzUserProfileModal").hidden = false;
}
function closeUserProfile() { viewedUserProfileId = null; $("dzUserProfileModal").hidden = true; }
$("userProfBackBtn").addEventListener("click", closeUserProfile);
$("userProfBellBtn").addEventListener("click", async () => {
  if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); refreshNotifyBtnVisibility(); } catch {} }
  if (viewedUserProfileId) {
    const next = !isUserNotifyAll(viewedUserProfileId);
    setUserChatPref(viewedUserProfileId, { notifyAll: next });
    showToast(next ? "تم تفعيل إشعارات هذا الحساب 🔔" : "تم إيقاف إشعارات هذا الحساب");
  }
});
$("userProfShareBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText("@" + (profilesMap[viewedUserProfileId]?.username || "user")); } catch {}
  showToast("تم نسخ اسم الحساب ↪️");
});
$("userProfTabs").addEventListener("click", e => {
  const btn = e.target.closest(".profile-tab"); if (!btn) return;
  viewedUserProfileTab = btn.dataset.utab;
  $("userProfTabs").querySelectorAll(".profile-tab").forEach(t => t.classList.toggle("active", t === btn));
  renderViewedUserProfile();
});

function renderViewedUserProfile() {
  if (!currentUser || !viewedUserProfileId) return;
  const u = profilesMap[viewedUserProfileId] || { id: viewedUserProfileId, username: "عضو" }, lr = liveRoomsCache.find(r => r.host_id === viewedUserProfileId);
  $("userProfDisplayName").textContent = u.username || "عضو"; $("userProfHandle").textContent = "@" + (u.username || "user");
  $("userProfBio").textContent = u.bio || ""; $("userProfCountry").textContent = u.country ? "📍 " + u.country : "";
  setAvatarContent($("userProfAvatar"), u.avatar_url, u.username);
  $("userProfAvatarWrap").classList.toggle("is-live", !!lr); $("userProfLiveBadge").hidden = !lr;
  $("userProfAvatarWrap").onclick = lr ? () => { closeUserProfile(); tryEnterLiveRoom(lr); } : null;

  const tp = videosCache.filter(v => v.user_id === viewedUserProfileId), ids = new Set(tp.map(v => v.id));
  $("userProfFollowingCount").textContent = formatCount(followsCache.filter(f => f.follower_id === viewedUserProfileId).length);
  $("userProfFollowersCount").textContent = formatCount(followsCache.filter(f => f.following_id === viewedUserProfileId).length);
  $("userProfLikesCount").textContent = formatCount(likesCache.filter(l => ids.has(l.video_id)).length);

  const iFollow = followsCache.some(f => f.follower_id === currentUser.id && f.following_id === viewedUserProfileId);
  const followsMe = followsCache.some(f => f.follower_id === viewedUserProfileId && f.following_id === currentUser.id);
  const actRow = $("userProfActionsRow"); actRow.textContent = "";
  if (!iFollow) {
    const fb = document.createElement("button"); fb.type = "button"; fb.className = "uprof-btn-main"; fb.textContent = "متابعة"; fb.onclick = () => toggleFollow(viewedUserProfileId);
    const mb = document.createElement("button"); mb.type = "button"; mb.className = "uprof-btn-sq"; mb.textContent = "💬"; mb.onclick = () => { const id = viewedUserProfileId; closeUserProfile(); openPrivateChat(id); };
    const sb = document.createElement("button"); sb.type = "button"; sb.className = "uprof-btn-sq"; sb.textContent = "👤＋"; sb.onclick = () => { closeUserProfile(); openFollowsModal("suggested"); };
    actRow.append(fb, mb, sb);
  } else {
    const mb = document.createElement("button"); mb.type = "button"; mb.className = "uprof-btn-gray"; mb.textContent = "مراسلة"; mb.onclick = () => { const id = viewedUserProfileId; closeUserProfile(); openPrivateChat(id); };
    const fb = document.createElement("button"); fb.type = "button"; fb.className = "uprof-btn-gray"; fb.textContent = (followsMe ? "الأصدقاء" : "أتابعه") + " ▾";
    fb.onclick = () => { if (confirm(`إلغاء متابعة @${u.username}؟`)) toggleFollow(viewedUserProfileId); };
    const sb = document.createElement("button"); sb.type = "button"; sb.className = "uprof-btn-sq"; sb.textContent = "👤＋"; sb.onclick = () => { closeUserProfile(); openFollowsModal("suggested"); };
    actRow.append(mb, fb, sb);
  }

  let items = tp;
  if (viewedUserProfileTab === "likes") { const ls = new Set(likesCache.filter(l => l.user_id === viewedUserProfileId).map(l => l.video_id)); items = videosCache.filter(v => ls.has(v.id)); }
  const grid = $("userProfGrid"); grid.textContent = "";
  if (!items.length) { grid.innerHTML = `<div class="grid-empty">لا توجد منشورات هنا.</div>`; return; }
  items.forEach(post => {
    const tile = document.createElement("div"); tile.className = "grid-post-tile";
    const ms = safeUrl(post.video_url, false);
    if (isImagePost(post)) { const img = document.createElement("img"); img.src = ms; tile.appendChild(img); }
    else { const vid = document.createElement("video"); vid.src = ms; vid.muted = true; vid.playsInline = true; vid.preload = "metadata"; tile.appendChild(vid); }
    const meta = document.createElement("div"); meta.className = "grid-post-meta"; meta.textContent = `▷ ${likesCache.filter(l => l.video_id === post.id).length}`; tile.appendChild(meta);
    tile.onclick = () => { closeUserProfile(); switchPage("homePage"); setTimeout(() => { const t = $("videoFeed").querySelector(`[data-video-id="${post.id}"]`); if (t) t.scrollIntoView({ behavior: "smooth" }); }, 60); };
    grid.appendChild(tile);
  });
}

function renderProfile() {
  if (!currentUser) return;
  const p = currentProfile || {}, username = (p.username || currentUser.email.split("@")[0]).replace(/^@/, "");
  $("profileDisplayName").textContent = username; $("profileName").textContent = "@" + username;
  $("profileBio").textContent = p.bio ? p.bio : "＋ إضافة سيرة ذاتية"; $("profileCountry").textContent = p.country ? "📍 " + p.country : "";
  $("profileThoughtText").textContent = getUserThought() || "ماذا يدور في ذهنك؟";
  setAvatarContent($("profileAvatar"), p.avatar_url, "الصورة الشخصية");

  const mp = videosCache.filter(v => v.user_id === currentUser.id), ids = new Set(mp.map(v => v.id));
  $("statFollowers").textContent = formatCount(followsCache.filter(f => f.following_id === currentUser.id).length);
  $("statFollowing").textContent = formatCount(followsCache.filter(f => f.follower_id === currentUser.id).length);
  $("statLikes").textContent = formatCount(likesCache.filter(l => ids.has(l.video_id)).length);

  let items = mp;
  if (activeProfileTab === "saved") { const s = new Set(getSavedPostIds()); items = videosCache.filter(v => s.has(v.id)); }
  else if (activeProfileTab === "likes") { const l = new Set(likesCache.filter(x => x.user_id === currentUser.id).map(x => x.video_id)); items = videosCache.filter(v => l.has(v.id)); }

  const grid = $("myVideosList"); grid.textContent = "";
  if (!items.length) {
    grid.innerHTML = `<div class="grid-empty">${activeProfileTab === "posts" ? "لم تنشر شيئاً بعد." : (activeProfileTab === "saved" ? "لا توجد محفوظات بعد." : "لا توجد إعجابات بعد.")}</div>`;
    return;
  }
  items.forEach(post => {
    const tile = document.createElement("div"); tile.className = "grid-post-tile";
    const ms = safeUrl(post.video_url, false);
    if (isImagePost(post)) { const img = document.createElement("img"); img.src = ms; tile.appendChild(img); }
    else { const vid = document.createElement("video"); vid.src = ms; vid.muted = true; vid.playsInline = true; vid.preload = "metadata"; tile.appendChild(vid); }
    const meta = document.createElement("div"); meta.className = "grid-post-meta"; meta.textContent = `▷ ${likesCache.filter(l => l.video_id === post.id).length}`; tile.appendChild(meta);
    tile.onclick = () => { switchPage("homePage"); setTimeout(() => { const t = $("videoFeed").querySelector(`[data-video-id="${post.id}"]`); if (t) t.scrollIntoView({ behavior: "smooth" }); }, 60); };
    grid.appendChild(tile);
  });
}

document.querySelectorAll("#profilePage .profile-tab").forEach(tab => {
  tab.addEventListener("click", () => { activeProfileTab = tab.dataset.tab; document.querySelectorAll("#profilePage .profile-tab").forEach(t => t.classList.toggle("active", t === tab)); renderProfile(); });
});
$("profileThoughtBubble").addEventListener("click", () => { $("dzThoughtInput").value = getUserThought(); $("dzThoughtModal").hidden = false; });
$("dzCloseThoughtBtn").addEventListener("click", () => { $("dzThoughtModal").hidden = true; });
$("dzSaveThoughtBtn").addEventListener("click", () => { setUserThought($("dzThoughtInput").value); $("dzThoughtModal").hidden = true; renderProfile(); renderInbox(); showToast("تم حفظ حالتك 💭"); });

$("profileMenuBtn").addEventListener("click", () => { $("dzProfileMenuModal").hidden = false; });
$("dzCloseProfileMenu").addEventListener("click", () => { $("dzProfileMenuModal").hidden = true; });
$("menuEditProfileBtn").addEventListener("click", () => { $("dzProfileMenuModal").hidden = true; openEditProfileModal(); });
$("menuCreateBtn").addEventListener("click", () => { $("dzProfileMenuModal").hidden = true; $("dzCreateChoiceModal").hidden = false; });
$("menuLogoutBtn").addEventListener("click", async () => { $("dzProfileMenuModal").hidden = true; if (!confirm("هل تريد تسجيل الخروج؟")) return; leaveLiveRoom(true); await db.auth.signOut(); showAuth(); showToast("تم تسجيل الخروج"); });

$("profileAddFriendBtn").addEventListener("click", () => openFollowsModal("suggested"));
$("profileTopEditBtn").addEventListener("click", openEditProfileModal);
$("profilePlusBtn").addEventListener("click", openEditProfileModal);
$("profileBioBtn").addEventListener("click", openEditProfileModal);
$("statFollowingBtn").addEventListener("click", () => openFollowsModal("following"));
$("statFollowersBtn").addEventListener("click", () => openFollowsModal("followers"));

function openFollowsModal(tab = "following") {
  if (!currentUser) return;
  activeFollowsTab = tab; $("followsHeaderUsername").textContent = currentProfile?.username || "حسابي"; $("followsSearchInput").value = "";
  $("followsTabs").querySelectorAll(".follows-tab").forEach(b => b.classList.toggle("active", b.dataset.ftab === tab));
  renderFollowsList(); $("dzFollowsModal").hidden = false;
}
$("followsBackBtn").addEventListener("click", () => { $("dzFollowsModal").hidden = true; });
$("followsAddFriendBtn").addEventListener("click", () => { $("dzFollowsModal").hidden = true; openSearchModal(); });
$("followsSearchInput").addEventListener("input", renderFollowsList);
$("followsTabs").addEventListener("click", e => {
  const btn = e.target.closest(".follows-tab"); if (!btn) return;
  activeFollowsTab = btn.dataset.ftab; $("followsTabs").querySelectorAll(".follows-tab").forEach(b => b.classList.toggle("active", b === btn)); renderFollowsList();
});

function renderFollowsList() {
  if (!currentUser) return;
  const f1 = new Set(followsCache.filter(f => f.follower_id === currentUser.id).map(f => f.following_id));
  const f2 = new Set(followsCache.filter(f => f.following_id === currentUser.id).map(f => f.follower_id));
  const fr = [...f1].filter(id => f2.has(id));
  $("ftabFollowingCount").textContent = f1.size; $("ftabFollowersCount").textContent = f2.size; $("ftabFriendsCount").textContent = fr.length;
  let ids = activeFollowsTab === "following" ? [...f1] : (activeFollowsTab === "followers" ? [...f2] : (activeFollowsTab === "friends" ? fr : Object.keys(profilesMap).filter(id => id !== currentUser.id && !f1.has(id))));
  const q = $("followsSearchInput").value.trim().toLowerCase(), users = ids.map(id => profilesMap[id]).filter(u => u && (u.username || "").toLowerCase().includes(q));
  const list = $("followsList"); list.textContent = "";
  if (!users.length) { list.innerHTML = `<p style="text-align:center;color:#6b7280;font-size:13px;padding:30px 0">لا يوجد أعضاء في هذه القائمة.</p>`; return; }
  users.forEach(u => {
    const isF = f1.has(u.id), isM = isF && f2.has(u.id), lr = liveRoomsCache.find(r => r.host_id === u.id);
    const row = document.createElement("div"); row.className = "follow-row";
    const left = document.createElement("div"); left.className = "follow-row-user";
    const av = document.createElement("div"); av.className = "follow-row-av" + (lr ? " is-live" : "");
    const avIn = document.createElement("div"); avIn.className = "follow-row-av-in"; setAvatarContent(avIn, u.avatar_url, u.username); av.appendChild(avIn);
    if (lr) { const b = document.createElement("span"); b.className = "story-live-badge"; b.textContent = "LIVE"; av.appendChild(b); av.onclick = e => { e.stopPropagation(); $("dzFollowsModal").hidden = true; tryEnterLiveRoom(lr); }; }
    const info = document.createElement("div"); info.className = "follow-row-info";
    const st = document.createElement("strong"); st.textContent = u.username || "عضو"; const sm = document.createElement("small"); sm.textContent = u.bio || u.country || "DZ-CHAT";
    info.append(st, sm); left.append(av, info); left.onclick = () => { $("dzFollowsModal").hidden = true; openUserProfile(u.id); };
    const right = document.createElement("div"); right.className = "follow-row-actions";
    const fb = document.createElement("button"); fb.type = "button"; fb.className = "follow-pill-btn" + (isF ? "" : " to-follow");
    fb.textContent = isM ? "الأصدقاء" : (isF ? "أتابعه" : "متابعة"); fb.onclick = () => toggleFollow(u.id);
    const dots = document.createElement("button"); dots.type = "button"; dots.className = "follow-dots-btn"; dots.textContent = "•••";
    dots.onclick = () => { $("dzFollowsModal").hidden = true; openPrivateChat(u.id); };
    right.append(fb, dots); row.append(left, right); list.appendChild(row);
  });
}

function openEditProfileModal() {
  if (!currentUser) return;
  const p = currentProfile || {};
  $("dzEditUsername").value = p.username || ""; $("dzEditBio").value = p.bio || ""; $("dzEditCountry").value = p.country || "الجزائر";
  $("dzEditAvatar").value = ""; $("dzProfileError").hidden = true; setAvatarContent($("dzAvatarPreview"), p.avatar_url, "معاينة");
  $("dzProfileModal").hidden = false;
}
$("dzCloseProfile").addEventListener("click", () => { $("dzProfileModal").hidden = true; });
$("dzProfileModal").addEventListener("click", e => { if (e.target === $("dzProfileModal")) $("dzProfileModal").hidden = true; });
$("dzEditAvatar").addEventListener("change", ev => {
  const f = ev.target.files[0]; if (!f) return;
  if (!isSafeImageFile(f, 5)) { ev.target.value = ""; return; }
  const r = new FileReader(); r.onload = () => setAvatarContent($("dzAvatarPreview"), r.result, "معاينة"); r.readAsDataURL(f);
});
$("dzSaveProfile").addEventListener("click", async () => {
  if (!currentUser || !checkRateLimit("saveProfile", 1200)) return;
  const btn = $("dzSaveProfile"), errBox = $("dzProfileError"), username = cleanText($("dzEditUsername").value.replace(/^@/, ""), 30);
  const bio = cleanText($("dzEditBio").value, 200), country = cleanText($("dzEditCountry").value, 40), imageFile = $("dzEditAvatar").files[0];
  errBox.hidden = true; if (username.length < 3) { errBox.textContent = "اسم المستخدم يجب أن يكون 3 أحرف على الأقل"; errBox.hidden = false; return; }
  if (imageFile && !isSafeImageFile(imageFile, 5)) return;
  btn.disabled = true; btn.textContent = "جارٍ الحفظ...";
  try {
    let avatarUrl = currentProfile?.avatar_url || null;
    if (imageFile) {
      const ext = imageFile.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const filePath = `${currentUser.id}/avatar_${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(filePath, imageFile, { upsert: true, contentType: imageFile.type || "image/jpeg" });
      if (upErr) throw upErr; avatarUrl = db.storage.from(STORAGE_BUCKET).getPublicUrl(filePath).data.publicUrl;
    }
    const { data, error } = await db.from("profiles").upsert({ id: currentUser.id, username, bio, country, avatar_url: avatarUrl }, { onConflict: "id" }).select().single();
    if (error) throw error;
    currentProfile = data; profilesMap[currentUser.id] = data;
    renderProfile(); renderVideoFeed(); renderFriendsFeed(); renderInbox();
    $("dzProfileModal").hidden = true; showToast("تم حفظ التعديلات بنجاح 🇩🇿");
  } catch (err) { errBox.textContent = err.message || "فشل الحفظ"; errBox.hidden = false; }
  finally { btn.disabled = false; btn.textContent = "حفظ التعديلات"; }
});

attachSwipeBack($("dzChatRoom"), closePrivateChat);
attachSwipeBack($("dzChatSettingsModal"), () => { $("dzChatSettingsModal").hidden = true; });
attachSwipeBack($("dzFollowsModal"), () => { $("dzFollowsModal").hidden = true; });
attachSwipeBack($("dzUserProfileModal"), closeUserProfile);
attachSwipeBack($("dzSearchModal"), () => { $("dzSearchModal").hidden = true; });
attachSwipeBack($("messagesPage"), () => switchPage("homePage"));
attachSwipeBack($("profilePage"), () => switchPage("homePage"));
attachSwipeBack($("uploadPage"), () => switchPage("homePage"));
attachSwipeBack($("discoverPage"), () => switchPage("homePage"));

navItems.forEach(button => {
  button.addEventListener("click", () => {
    if (!currentUser) return;
    if (button.dataset.page === "uploadPage") { $("dzCreateChoiceModal").hidden = false; return; }
    switchPage(button.dataset.page);
  });
});

app.style.display = "none"; showAuth();
(async () => { const { data } = await db.auth.getSession(); if (data.session?.user) await loadUser(data.session.user); })();
