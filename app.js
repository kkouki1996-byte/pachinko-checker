// ===== 定数 =====
const BALLS_PER_1K = 250;
const NUM_TABS = 3;
const STORAGE_KEY = 'pachinko_checker_v2';
const MAX_SEC_ROT = 10000;      // 区間回転数の上限（5桁異常値）
const RATE_CHANGE_LIMIT = 10;   // 回転率の警告変動幅
const KO_DEFAULT_BALLS = 280;   // 小当たりデフォルト出玉
const KO_DEFAULT_R = 2;         // 小当たりデフォルトR数
const CASH_PER_UNIT = 500;      // 現金1単位（円）
const BALLS_PER_CASH = 125;     // 500円あたりの玉数

// ===== 初期タブデータ =====
function createTabData(name) {
  return {
    name,
    started: false,
    startRot: 0,
    startBalls: 0,
    prevRot: 0,
    prevBalls: 0,
    curRot: 0,
    curBalls: 0,
    totalRot: 0,
    totalUsed: 0,
    history: [],
    isHit: false,
    hitRot: 0,
    hitBalls: 0,
    hitPrevRot: 0,
    hitPrevBalls: 0,
    hitCho: 0,
    hitMochi: 0,
    hitSnapshot: null,
    deletedBackup: null,
    cashInvested: 0,
    lastChodama: 0,
    lastSecRate: null,
    rateWarnAcknowledged: false,
    sessionStart: null,
    historyOpen: false,
  };
}

// ===== 状態 =====
let state = {
  activeTab: 0,
  tabs: Array.from({ length: NUM_TABS }, (_, i) => createTabData(`台${i + 1}`)),
};

// 履歴削除用の一時インデックス
let pendingDeleteIndex = null;

// ===== localStorage =====
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // バックアップも保存（二重化）
    localStorage.setItem(STORAGE_KEY + '_backup', JSON.stringify({ data: state, ts: Date.now() }));
  } catch (e) {}
}
function loadState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    let parsed = raw ? JSON.parse(raw) : null;

    // メインが壊れていればバックアップから復元
    if (!parsed || !parsed.tabs) {
      const backupRaw = localStorage.getItem(STORAGE_KEY + '_backup');
      if (backupRaw) {
        const backup = JSON.parse(backupRaw);
        if (backup && backup.data && backup.data.tabs) parsed = backup.data;
      }
    }
    if (!parsed || !parsed.tabs) return;

    // タブ数が一致すればそのまま、足りなければ補完
    if (parsed.tabs.length === NUM_TABS) {
      state = parsed;
    } else {
      // タブ数が違っても既存データを可能な限り引き継ぐ
      const newTabs = [];
      for (let i = 0; i < NUM_TABS; i++) {
        newTabs.push(parsed.tabs[i] || createTabData());
      }
      state = { activeTab: Math.min(parsed.activeTab || 0, NUM_TABS - 1), tabs: newTabs };
    }

    // 各タブに新しいフィールドが無い場合はデフォルトを補完
    state.tabs.forEach(tab => {
      const def = createTabData();
      for (const key in def) {
        if (tab[key] === undefined) tab[key] = def[key];
      }
    });
  } catch (e) {}
}

// ===== ユーティリティ =====
function getTab() { return state.tabs[state.activeTab]; }

function calcRate(rot, used) {
  if (used <= 0) return null;
  return rot / (used / BALLS_PER_1K);
}
function formatRate(rate) {
  if (rate === null || rate === undefined) return null;
  return Math.round(rate * 10) / 10;
}
function elapsedHours(tab) {
  if (!tab.sessionStart) return 0;
  return (Date.now() - tab.sessionStart) / 3600000;
}
function calcSpeed(tab) {
  const h = elapsedHours(tab);
  if (h <= 0 || tab.totalRot <= 0) return null;
  return Math.round(tab.totalRot / h);
}

// ===== エラー表示 =====
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
}
function clearError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

// ===== タブ描画 =====
// ===== 差玉計算 =====
// 差玉 = 現在の玉数 − 開始時の玉数 − 現金投資分の玉数
function calcDiff(tab, balls) {
  const cur = balls !== undefined ? balls : tab.curBalls;
  const cashBalls = Math.floor((tab.cashInvested || 0) / CASH_PER_UNIT) * BALLS_PER_CASH;
  return cur - tab.startBalls - cashBalls;
}
function setDiffText(el, diff) {
  if (!el) return;
  el.textContent = (diff >= 0 ? '+' : '') + diff.toLocaleString() + '玉';
  el.style.color = diff >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
}

function renderTabs() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';
  state.tabs.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (i === state.activeTab ? ' active' : '');
    btn.textContent = tab.name;
    btn.addEventListener('click', () => switchTab(i));
    bar.appendChild(btn);
  });
  updateTabbarHeight();
}

// モーダルをタブバーの下に配置するため高さをCSS変数に渡す
function updateTabbarHeight() {
  const bar = document.getElementById('tab-bar');
  if (bar) document.documentElement.style.setProperty('--tabbar-h', bar.offsetHeight + 'px');
}
window.addEventListener('resize', updateTabbarHeight);
window.addEventListener('orientationchange', updateTabbarHeight);

// ===== メイン描画 =====
function renderAll() {
  renderTabs();
  const tab = getTab();
  document.getElementById('start-form').style.display = tab.started ? 'none' : 'block';
  document.getElementById('session-view').style.display = tab.started ? 'block' : 'none';
  if (!tab.started) {
    document.getElementById('start-rot').value = '';
    document.getElementById('start-chodama').value = '';
    document.getElementById('start-mochidama').value = '';
    document.getElementById('start-total').textContent = '0';
    clearError('start-error');
  } else {
    renderSessionView(tab);
  }
}

function renderSessionView(tab) {
  // 累計回転率
  const rate = calcRate(tab.totalRot, tab.totalUsed);
  const rateEl = document.getElementById('rate-value');
  if (rate !== null) {
    rateEl.textContent = formatRate(rate);
    rateEl.className = 'rate-value';
    document.getElementById('rate-unit').textContent = '回転/k';
  } else {
    rateEl.textContent = 'データなし';
    rateEl.className = 'rate-value no-data';
    document.getElementById('rate-unit').textContent = '';
  }

  document.getElementById('stat-rot').textContent = tab.totalRot.toLocaleString();
  document.getElementById('stat-cur-rot').textContent = tab.curRot.toLocaleString();
  document.getElementById('stat-start-rot').textContent = tab.startRot.toLocaleString();

  const ballsDiff = tab.curBalls - tab.startBalls;
  const ballsEl = document.getElementById('stat-balls');
  ballsEl.textContent = tab.curBalls.toLocaleString();
  ballsEl.className = 'stat-value' + (ballsDiff >= 0 ? ' highlight' : '');

  const speed = calcSpeed(tab);
  document.getElementById('stat-speed').textContent = speed !== null ? speed.toLocaleString() : '---';
  setDiffText(document.getElementById('stat-diff'), calcDiff(tab));

  const banner = document.getElementById('hit-banner');
  if (tab.isHit) {
    banner.classList.add('visible');
    banner.textContent = `🎰 当たり中！  ${tab.hitRot}回転 / ${tab.hitBalls.toLocaleString()}玉`;
  } else {
    banner.classList.remove('visible');
  }

  document.getElementById('btn-hit').disabled = tab.isHit;
  document.getElementById('btn-kohit').disabled = tab.isHit;
  document.getElementById('btn-hit-undo').disabled = !tab.isHit;

  renderHistory(tab);
  renderHitSummary(tab);
  renderCashAmount(tab);
  renderSavedMachines();
}

// ===== 当たりサマリー描画 =====
function renderHitSummary(tab) {
  const summaryEl = document.getElementById('hit-summary');
  if (tab.history.length === 0) {
    summaryEl.style.display = 'none';
    return;
  }
  summaryEl.style.display = 'block';

  // 平均1R出玉
  const rHistories = tab.history.filter(h => h.per1r !== null && h.per1r !== undefined);
  const avg1r = rHistories.length > 0
    ? (rHistories.reduce((s, h) => s + h.per1r, 0) / rHistories.length).toFixed(1)
    : null;
  document.getElementById('summary-1r').textContent = avg1r !== null ? avg1r : '---';

  // 合計獲得出玉
  const totalGained = tab.history.reduce((s, h) => s + h.gained, 0);
  document.getElementById('summary-gained').textContent =
    (totalGained >= 0 ? '+' : '') + totalGained.toLocaleString() + '玉';

  // 合計獲得R数
  const totalR = tab.history.reduce((s, h) => s + (h.r || 0), 0);
  document.getElementById('summary-r').textContent = totalR > 0 ? totalR + 'R' : '---';

  // 当たり回数
  document.getElementById('summary-count').textContent = tab.history.length + '回';
}

function renderHistory(tab) {
  // 復元ボタンの表示制御
  const restoreBtn = document.getElementById('btn-restore-deleted');
  if (restoreBtn) restoreBtn.style.display = tab.deletedBackup ? 'block' : 'none';

  const toggle = document.getElementById('history-toggle');
  const list = document.getElementById('history-list');
  toggle.textContent = tab.historyOpen ? '履歴 ▲' : '履歴 ▼';
  list.classList.toggle('open', tab.historyOpen);

  list.innerHTML = '';
  if (tab.history.length === 0) {
    list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;text-align:center">履歴なし</div>';
    return;
  }
  // 編集ヒント
  const hint = document.createElement('div');
  hint.style.cssText = 'padding:8px 16px;font-size:11px;color:var(--text-muted);text-align:center;border-bottom:1px solid var(--border);';
  hint.textContent = '記録をタップで編集 / 🗑で削除';
  list.appendChild(hint);

  // 新しい順（インデックスは元配列基準）
  [...tab.history].reverse().forEach((h, revIdx) => {
    const realIdx = tab.history.length - 1 - revIdx;
    const div = document.createElement('div');
    div.className = 'history-item';
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';

    // 区間情報を3行で表示
    let info = '';
    // 小当たりバッジ
    if (h.isKo) {
      info += `<span style="font-size:11px;color:#2fc5f7;font-weight:700">✨小当たり</span><br>`;
    }
    // 1行目：使用k
    if (h.usedK !== null && h.usedK !== undefined) {
      info += `<span style="font-size:13px;color:#a0a0c0">${h.usedK}k 使用</span><br>`;
    }
    // 2行目：回転数
    if (h.secRot !== undefined && h.secRot > 0) {
      info += `<span style="font-size:13px;color:#a0a0c0">${h.secRot}回</span>`;
      // 平均回転率
      if (h.secRate !== null && h.secRate !== undefined) {
        info += `<span style="font-size:13px;color:var(--accent)">　平均${h.secRate}</span>`;
      }
      info += `<br>`;
    }
    // 3行目：出玉
    info += `<span class="h-balls" style="font-size:16px;font-weight:700">${h.gained >= 0 ? '+' : ''}${h.gained.toLocaleString()}玉</span>`;
    if (h.per1r !== null && h.per1r !== undefined) {
      info += `　<span class="h-1r">1R：${Math.round(h.per1r)}玉</span>`;
    }

    const infoSpan = document.createElement('span');
    infoSpan.innerHTML = info;
    infoSpan.style.cursor = 'pointer';
    infoSpan.style.flex = '1';
    infoSpan.addEventListener('click', () => openEditModal(realIdx));

    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑';
    delBtn.style.cssText = 'background:none;border:none;color:var(--accent-red);font-size:16px;padding:4px 8px;cursor:pointer;min-height:36px;flex-shrink:0;';
    delBtn.addEventListener('click', () => openDeleteModal(realIdx));

    div.appendChild(infoSpan);
    div.appendChild(delBtn);
    list.appendChild(div);
  });
}

// ===== セッション開始 =====
function handleStart() {
  const rotVal = document.getElementById('start-rot').value.trim();
  const choVal = document.getElementById('start-chodama').value.trim();
  const mochiVal = document.getElementById('start-mochidama').value.trim();
  if (rotVal === '') {
    showError('start-error', '開始回転数を入力してください');
    return;
  }
  const rot = parseInt(rotVal, 10);
  const cho = choVal === '' ? 0 : parseInt(choVal, 10);
  const mochi = mochiVal === '' ? 0 : parseInt(mochiVal, 10);
  if (isNaN(rot) || isNaN(cho) || isNaN(mochi) || rot < 0 || cho < 0 || mochi < 0) {
    showError('start-error', '正しい数値を入力してください');
    return;
  }
  const balls = cho + mochi; // 貯玉＋持ち玉の合計
  clearError('start-error');
  // 開始時の貯玉を記憶
  const tab = getTab();
  tab.started = true;
  tab.startRot = rot;
  tab.startBalls = balls;
  tab.prevRot = rot;
  tab.prevBalls = balls;
  tab.curRot = rot;
  tab.curBalls = balls;
  tab.totalRot = 0;
  tab.totalUsed = 0;
  tab.history = [];
  tab.isHit = false;
  tab.hitRot = 0;
  tab.hitBalls = 0;
  tab.cashInvested = 0;
  tab.lastChodama = cho;
  tab.sessionStart = Date.now();
  tab.historyOpen = false;
  clearDraft();
  saveState();
  renderAll();
}

// 開始フォームの合計をリアルタイム表示
function updateStartTotal() {
  const cho = parseInt(document.getElementById('start-chodama').value, 10) || 0;
  const mochi = parseInt(document.getElementById('start-mochidama').value, 10) || 0;
  document.getElementById('start-total').textContent = (cho + mochi).toLocaleString();
}

// ===== 当たり記録モーダル =====
function openHitModal() {
  document.getElementById('hit-rot-input').value = '';
  document.getElementById('hit-cho-input').value = '';
  document.getElementById('hit-mochi-input').value = '';
  document.getElementById('hit-total').textContent = '0';
  clearError('hit-modal-error');
  getTab().rateWarnAcknowledged = false;
  document.getElementById('hit-modal').classList.add('open');
}

function closeHitModal() {
  document.getElementById('hit-modal').classList.remove('open');
  clearDraft();
  document.getElementById('hit-modal-confirm').textContent = '記録する';
  clearError('hit-modal-error');
}

function handleHitConfirm() {
  const rotVal = document.getElementById('hit-rot-input').value.trim();
  const choVal = document.getElementById('hit-cho-input').value.trim();
  const mochiVal = document.getElementById('hit-mochi-input').value.trim();
  clearError('hit-modal-error');

  if (rotVal === '' || (choVal === '' && mochiVal === '')) {
    showError('hit-modal-error', '回転数と玉数を入力してください');
    return;
  }
  const rot = parseInt(rotVal, 10);
  const cho = choVal === '' ? 0 : parseInt(choVal, 10);
  const mochi = mochiVal === '' ? 0 : parseInt(mochiVal, 10);
  const balls = cho + mochi;
  if (isNaN(rot) || isNaN(cho) || isNaN(mochi) || rot < 0 || cho < 0 || mochi < 0) {
    showError('hit-modal-error', '正しい数値を入力してください');
    return;
  }
  getTab().lastChodama = cho;

  const tab = getTab();
  if (rot <= tab.prevRot) {
    showError('hit-modal-error', `回転数は前回(${tab.prevRot})より大きい値を入力してください`);
    return;
  }

  // 当たり記録前に区間計算（通常遊技分）
  const secRot = rot - tab.prevRot;

  // 異常値チェック：区間回転数が10000以上
  if (secRot >= MAX_SEC_ROT) {
    showError('hit-modal-error', `区間回転数が${secRot}回と異常に多いです。入力を確認してください`);
    return;
  }

  // 警告チェック：回転率が前回と10以上変動
  if (tab.lastSecRate !== null && tab.lastSecRate !== undefined) {
    const secUsedTmp = tab.prevBalls - balls;
    if (secUsedTmp > 0) {
      const newRate = secRot / (secUsedTmp / BALLS_PER_1K);
      const diff = Math.abs(newRate - tab.lastSecRate);
      if (diff >= RATE_CHANGE_LIMIT) {
        if (!tab.rateWarnAcknowledged) {
          tab.rateWarnAcknowledged = true;
          showError('hit-modal-error',
            `⚠️ 回転率が${newRate.toFixed(1)}（前回${tab.lastSecRate.toFixed(1)}）と大きく変動。確認OKなら再度「記録する」をタップ`);
          document.getElementById('hit-modal-confirm').textContent = '⚠️ それでも記録する';
          return;
        }
      }
    }
  }
  tab.rateWarnAcknowledged = false;
  const secUsed = tab.prevBalls - balls;

  // 取り消し用にスナップショット保存
  tab.hitSnapshot = {
    prevRot: tab.prevRot,
    prevBalls: tab.prevBalls,
    curRot: tab.curRot,
    curBalls: tab.curBalls,
    totalRot: tab.totalRot,
    totalUsed: tab.totalUsed,
  };

  if (secUsed > 0) {
    tab.totalRot += secRot;
    tab.totalUsed += secUsed;
  } else if (secRot > 0) {
    tab.totalRot += secRot;
  }

  tab.curRot = rot;
  tab.curBalls = balls;
  tab.prevRot = rot;
  tab.prevBalls = balls;

  // 当たり記録（区間計算用に直前のprev値も保存）
  tab.hitPrevRot = tab.hitSnapshot.prevRot;
  tab.hitPrevBalls = tab.hitSnapshot.prevBalls;
  tab.hitRot = rot;
  tab.hitBalls = balls;
  tab.hitCho = cho;      // 当たり時の貯玉
  tab.hitMochi = mochi;  // 当たり時の持ち玉
  tab.isHit = true;

  document.getElementById('hit-modal-confirm').textContent = '記録する';
  closeHitModal();
  saveState();
  renderSessionView(tab);
  // 即座に出玉入力モーダルへ移行
  openPayoutModal();
}

// ===== 現金投資モーダル =====
function openCashModal() {
  const tab = getTab();
  document.getElementById('cash-zandama-input').value = '';
  renderCashAmount(tab);
  document.getElementById('cash-modal').classList.add('open');
}

function closeCashModal() {
  document.getElementById('cash-modal').classList.remove('open');
}

function renderCashAmount(tab) {
  document.getElementById('cash-amount').textContent = tab.cashInvested.toLocaleString() + '円';
  const label = document.getElementById('cash-total-label');
  if (label) label.textContent = tab.cashInvested.toLocaleString();
}

function handleCashPlus() {
  const tab = getTab();
  tab.cashInvested += CASH_PER_UNIT;
  saveState();
  renderCashAmount(tab);
}

function handleCashMinus() {
  const tab = getTab();
  tab.cashInvested = Math.max(0, tab.cashInvested - CASH_PER_UNIT);
  saveState();
  renderCashAmount(tab);
}

// ===== 小当たり記録モーダル =====
function openKohitModal() {
  document.getElementById('kohit-rot-input').value = '';
  document.getElementById('kohit-cho-input').value = '';
  document.getElementById('kohit-mochi-input').value = '';
  document.getElementById('kohit-total').textContent = '0';
  document.getElementById('kohit-payout-input').value = KO_DEFAULT_BALLS;
  document.getElementById('kohit-r-input').value = KO_DEFAULT_R;
  document.getElementById('kohit-endrot-input').value = '';
  document.getElementById('kohit-detail-fields').style.display = 'none';
  document.getElementById('kohit-detail-toggle').textContent = '詳細設定（出玉280・R数2）▼';
  pendingKohitConfirmed = false;
  clearError('kohit-modal-error');
  document.getElementById('kohit-modal').classList.add('open');
}

function closeKohitModal() {
  document.getElementById('kohit-modal').classList.remove('open');
  clearDraft();
  pendingKohitConfirmed = false;
}

let pendingKohitConfirmed = false;

function handleKohitConfirm() {
  const payoutValCheck = document.getElementById('kohit-payout-input').value.trim();
  const rValCheck = document.getElementById('kohit-r-input').value.trim();
  const koPayoutCheck = payoutValCheck === '' ? KO_DEFAULT_BALLS : parseInt(payoutValCheck, 10);
  const koRCheck = rValCheck === '' ? KO_DEFAULT_R : parseInt(rValCheck, 10);

  if (!pendingKohitConfirmed && (koPayoutCheck !== KO_DEFAULT_BALLS || koRCheck !== KO_DEFAULT_R)) {
    document.getElementById('kohit-value-confirm-desc').textContent =
      `出玉${koPayoutCheck}玉・R数${koRCheck}で記録します。よろしいですか？`;
    document.getElementById('kohit-value-confirm-modal').classList.add('open');
    return;
  }
  pendingKohitConfirmed = false;

  const rotVal = document.getElementById('kohit-rot-input').value.trim();
  const choVal = document.getElementById('kohit-cho-input').value.trim();
  const mochiVal = document.getElementById('kohit-mochi-input').value.trim();
  const payoutVal = document.getElementById('kohit-payout-input').value.trim();
  const rVal = document.getElementById('kohit-r-input').value.trim();
  clearError('kohit-modal-error');

  if (rotVal === '' || (choVal === '' && mochiVal === '')) {
    showError('kohit-modal-error', '回転数と玉数を入力してください');
    return;
  }
  const rot = parseInt(rotVal, 10);
  const kohitCho = choVal === '' ? 0 : parseInt(choVal, 10);
  const kohitMochi = mochiVal === '' ? 0 : parseInt(mochiVal, 10);
  const curBalls = kohitCho + kohitMochi;
  getTab().lastChodama = kohitCho;
  const koPayout = payoutVal === '' ? KO_DEFAULT_BALLS : parseInt(payoutVal, 10);
  const koR = rVal === '' ? KO_DEFAULT_R : parseInt(rVal, 10);
  const endRotVal = document.getElementById('kohit-endrot-input').value.trim();
  // 保留消化後の回転数（空欄なら当選時の回転数を使用）
  const koEndRot = endRotVal === '' ? rot : parseInt(endRotVal, 10);

  if (isNaN(rot) || isNaN(curBalls) || rot < 0 || curBalls < 0) {
    showError('kohit-modal-error', '正しい数値を入力してください');
    return;
  }

  const tab = getTab();
  if (rot <= tab.prevRot) {
    showError('kohit-modal-error', `回転数は前回(${tab.prevRot})より大きい値を入力してください`);
    return;
  }
  if (endRotVal !== '' && (isNaN(koEndRot) || koEndRot < 0)) {
    showError('kohit-modal-error', '保留消化後の回転数を正しく入力してください');
    return;
  }

  // 当選時の持ち玉 = 現在持ち玉 - 小当たり出玉
  const hitBalls = curBalls - koPayout;

  // 通常区間（前回 → 当選時）の計算
  const secRot = rot - tab.prevRot;
  const secUsedBalls = tab.prevBalls - hitBalls;
  const usedK = secUsedBalls > 0 ? (secUsedBalls / BALLS_PER_1K).toFixed(1) : null;
  const secRate = (secRot > 0 && secUsedBalls > 0)
    ? Math.round(secRot / (secUsedBalls / BALLS_PER_1K) * 10) / 10 : null;

  // 累計に加算
  const snapPrevRot = tab.prevRot;
  const snapPrevBalls = tab.prevBalls;
  const snapTotalRot = tab.totalRot;
  const snapTotalUsed = tab.totalUsed;

  if (secUsedBalls > 0) {
    tab.totalRot += secRot;
    tab.totalUsed += secUsedBalls;
  } else if (secRot > 0) {
    tab.totalRot += secRot;
  }

  const per1r = koR > 0 ? koPayout / koR : null;

  // 履歴に追加（小当たりフラグ付き）
  tab.history.push({
    isKo: true,
    hitRot: rot,
    hitBalls,
    hitCho: kohitCho,
    hitMochi: Math.max(0, hitBalls - kohitCho),
    payoutCho: kohitCho,
    payoutMochi: kohitMochi,
    payoutBalls: curBalls,
    gained: koPayout,
    r: koR > 0 ? koR : null,
    per1r,
    endRot: koEndRot,
    secRot,
    secUsedBalls,
    usedK,
    secRate,
    snapPrevRot,
    snapPrevBalls,
    snapTotalRot,
    snapTotalUsed,
  });

  // 状態更新（保留消化後の回転数を次区間のスタートに）
  tab.curRot = koEndRot;
  tab.prevRot = koEndRot;
  tab.curBalls = curBalls;
  tab.prevBalls = curBalls;

  if (secRate !== null) tab.lastSecRate = secRate;

  closeKohitModal();
  saveState();
  renderSessionView(tab);
}

// ===== 当たり記録取り消し =====
function handleHitUndo() {
  const tab = getTab();
  if (!tab.isHit) return;
  // スナップショットで完全に戻す
  if (tab.hitSnapshot) {
    tab.prevRot   = tab.hitSnapshot.prevRot;
    tab.prevBalls = tab.hitSnapshot.prevBalls;
    tab.curRot    = tab.hitSnapshot.curRot;
    tab.curBalls  = tab.hitSnapshot.curBalls;
    tab.totalRot  = tab.hitSnapshot.totalRot;
    tab.totalUsed = tab.hitSnapshot.totalUsed;
    tab.hitSnapshot = null;
  }
  tab.isHit = false;
  tab.hitRot = 0;
  tab.hitBalls = 0;
  tab.hitPrevRot = 0;
  tab.hitPrevBalls = 0;
  saveState();
  renderSessionView(tab);
}

// ===== 出玉確定モーダル =====
function openPayoutModal() {
  const tab = getTab();
  document.getElementById('payout-cho-input').value = '';
  document.getElementById('payout-mochi-input').value = '';
  document.getElementById('payout-total').textContent = '0';
  document.getElementById('payout-r-input').value = '';
  document.getElementById('payout-endrot-input').value = '';
  document.getElementById('payout-gain-input').value = '';
  document.getElementById('gain-fields').style.display = 'none';
  document.getElementById('gain-toggle').textContent = '＋ 獲得出玉から計算する ▼';
  renderGainTotal();
  clearError('payout-error');

  renderPayoutSection(tab);
  document.getElementById('payout-modal').classList.add('open');
}

// 出玉確定画面の「この区間の結果」を描画
function renderPayoutSection(tab) {
  const secRot = tab.hitRot - tab.hitPrevRot;
  const secUsedBalls = tab.hitPrevBalls - tab.hitBalls;
  document.getElementById('payout-sec-rot').textContent = secRot > 0 ? secRot + '回' : '---';
  const secUsedK = secUsedBalls > 0 ? (secUsedBalls / BALLS_PER_1K).toFixed(1) + 'k' : '---';
  document.getElementById('payout-sec-used').textContent = secUsedK;
  const secRate = (secRot > 0 && secUsedBalls > 0)
    ? Math.round(secRot / (secUsedBalls / BALLS_PER_1K) * 10) / 10 : null;
  document.getElementById('payout-sec-rate').textContent = secRate !== null ? formatRate(secRate) : '---';
  updatePayoutDiff();
}

// 獲得出玉から求まる総持ち玉を表示
function renderGainTotal() {
  const el = document.getElementById('gain-total');
  if (!el) return;
  const tab = getTab();
  const v = document.getElementById('payout-gain-input').value.trim();
  const g = parseInt(v, 10);
  if (v === '' || isNaN(g) || !tab) { el.textContent = '---'; return; }
  el.textContent = (tab.hitBalls + g).toLocaleString() + '玉';
}

// 確定後の総持ち玉（獲得出玉が入っていればそちらを優先）
function payoutBallsNow() {
  const tab = getTab();
  const gainVal = document.getElementById('payout-gain-input').value.trim();
  if (gainVal !== '') {
    const g = parseInt(gainVal, 10);
    if (!isNaN(g)) return tab.hitBalls + g;
    return null;
  }
  const choVal = document.getElementById('payout-cho-input').value.trim();
  const mochiVal = document.getElementById('payout-mochi-input').value.trim();
  if (choVal === '' && mochiVal === '') return null;
  return (parseInt(choVal, 10) || 0) + (parseInt(mochiVal, 10) || 0);
}

// 入力中の玉数から「確定後の差玉」をリアルタイム表示
function updatePayoutDiff() {
  const tab = getTab();
  const el = document.getElementById('payout-diff');
  const balls = payoutBallsNow();
  if (balls === null) {
    el.textContent = '---';
    el.style.color = '';
    return;
  }
  setDiffText(el, calcDiff(tab, balls));
}

function closePayoutModal() {
  document.getElementById('payout-modal').classList.remove('open');
  clearDraft();
}

function handlePayoutConfirm() {
  const choVal = document.getElementById('payout-cho-input').value.trim();
  const mochiVal = document.getElementById('payout-mochi-input').value.trim();
  const gainVal = document.getElementById('payout-gain-input').value.trim();
  const rVal = document.getElementById('payout-r-input').value.trim();
  const endRotVal = document.getElementById('payout-endrot-input').value.trim();
  clearError('payout-error');

  const t0 = getTab();
  let cho, mochi, balls;

  if (gainVal !== '') {
    // 獲得出玉から計算：当たり時の玉数 ＋ 獲得出玉
    const gain = parseInt(gainVal, 10);
    if (isNaN(gain) || gain < 0) { showError('payout-error', '獲得出玉を正しく入力してください'); return; }
    balls = t0.hitBalls + gain;
    cho = t0.hitCho || 0;            // 貯玉はそのまま引き継ぐ
    mochi = Math.max(0, balls - cho);
  } else {
    if (choVal === '' && mochiVal === '') { showError('payout-error', '玉数か獲得出玉を入力してください'); return; }
    cho = choVal === '' ? 0 : parseInt(choVal, 10);
    mochi = mochiVal === '' ? 0 : parseInt(mochiVal, 10);
    if (isNaN(cho) || isNaN(mochi) || cho < 0 || mochi < 0) { showError('payout-error', '正しい数値を入力してください'); return; }
    balls = cho + mochi;
  }
  t0.lastChodama = cho;

  if (endRotVal === '') { showError('payout-error', '時短終了後の回転数を入力してください'); return; }
  const endRot = parseInt(endRotVal, 10);
  const tab = getTab();
  if (isNaN(endRot) || endRot < 0) {
    showError('payout-error', '正しい回転数を入力してください');
    return;
  }

  const gained = balls - tab.hitBalls;
  let per1r = null;
  if (rVal !== '') {
    const r = parseInt(rVal, 10);
    if (!isNaN(r) && r > 0) per1r = gained / r;
  }

  // 区間計算（当たり記録時点までの区間）
  const secRot = tab.hitRot - tab.hitPrevRot;
  const secUsedBalls = tab.hitPrevBalls - tab.hitBalls;
  const usedK = secUsedBalls > 0 ? (secUsedBalls / BALLS_PER_1K).toFixed(1) : null;
  const secRate = (secRot > 0 && secUsedBalls > 0)
    ? Math.round(secRot / (secUsedBalls / BALLS_PER_1K) * 10) / 10
    : null;

  tab.history.push({
    hitRot: tab.hitRot,
    hitBalls: tab.hitBalls,
    hitCho: tab.hitCho || 0,        // 当たり時の貯玉
    hitMochi: (tab.hitMochi !== undefined) ? tab.hitMochi : tab.hitBalls,
    payoutCho: cho,                 // 出玉確定時の貯玉
    payoutMochi: mochi,
    payoutBalls: balls,
    gained,
    r: (rVal !== '' && parseInt(rVal, 10) > 0) ? parseInt(rVal, 10) : null,
    per1r,
    endRot,
    secRot,
    secUsedBalls,
    usedK,
    secRate,
    // 削除時の復元用
    snapPrevRot: tab.hitPrevRot,
    snapPrevBalls: tab.hitPrevBalls,
    snapTotalRot: tab.totalRot - (secUsedBalls > 0 ? secRot : secRot > 0 ? secRot : 0),
    snapTotalUsed: tab.totalUsed - (secUsedBalls > 0 ? secUsedBalls : 0),
  });

  tab.curBalls = balls;
  tab.curRot = endRot;
  tab.prevRot = endRot;
  tab.prevBalls = balls;
  tab.isHit = false;
  tab.hitRot = 0;
  tab.hitBalls = 0;
  tab.hitCho = 0;
  tab.hitMochi = 0;

  // 今回の区間回転率を次回の比較用に保存
  if (secRate !== null) tab.lastSecRate = secRate;

  closePayoutModal();
  saveState();
  renderSessionView(tab);
}

// ===== 台の記録 =====
const SAVED_KEY = STORAGE_KEY + '_saved';
let savedDeleted = null;
let savedOpen = false;
let svMsgTimer = null;

function loadSavedMachines() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function storeSavedMachines(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (e) {}
}

function showSvMsg(text, isErr) {
  const el = document.getElementById('sv-msg');
  el.textContent = text;
  el.style.color = isErr ? 'var(--accent-red)' : 'var(--accent-green)';
  el.style.display = 'block';
  if (svMsgTimer) clearTimeout(svMsgTimer);
  svMsgTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);
}

function saveCurrentMachine() {
  const tab = getTab();
  if (!tab.started) { showSvMsg('セッション開始後に保存できます', true); return; }
  const no = document.getElementById('sv-no').value.trim();
  const memo = document.getElementById('sv-memo').value.trim();
  const rate = calcRate(tab.totalRot, tab.totalUsed);
  const d = new Date();
  const rec = {
    tabIndex: state.activeTab,
    no, memo,
    rot: tab.totalRot,
    used: tab.totalUsed,
    rate: rate,
    hits: tab.history.length,
    diff: calcDiff(tab),
    cash: tab.cashInvested || 0,
    date: (d.getMonth() + 1) + '/' + d.getDate(),
  };
  const list = loadSavedMachines();
  list.unshift(rec);
  storeSavedMachines(list);
  document.getElementById('sv-no').value = '';
  document.getElementById('sv-memo').value = '';
  savedOpen = true;
  renderSavedMachines();
  showSvMsg('保存しました', false);
}

function renderSavedMachines() {
  const list = loadSavedMachines();
  const box = document.getElementById('saved-list');
  const toggle = document.getElementById('saved-toggle');
  box.style.display = savedOpen ? 'block' : 'none';
  toggle.textContent = (savedOpen ? '保存した台 ▲（' : '保存した台 ▼（') + list.length + '件）';
  box.innerHTML = '';
  if (list.length === 0) {
    box.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:13px;text-align:center">保存した台はありません</div>';
    appendSavedUndo(box);
    return;
  }
  list.forEach((s, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:12px 2px;border-bottom:1px solid var(--border);';

    const main = document.createElement('div');
    main.style.cssText = 'flex:1;min-width:0;';

    let head = '<span style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--accent)">'
      + (s.no ? s.no + '番' : '台番号なし') + '</span>';
    head += ' <span style="font-family:var(--font-mono);font-size:15px;font-weight:700;color:var(--accent-green)">'
      + (s.rate !== null && s.rate !== undefined ? formatRate(s.rate) : '---') + '</span>';
    head += ' <span style="font-size:11px;color:var(--text-muted)">回転/k　' + (s.date || '') + '</span>';

    const diff = s.diff || 0;
    let sub = '<div style="font-size:12px;color:var(--text-secondary);font-family:var(--font-mono);margin-top:2px">'
      + s.rot.toLocaleString() + '回転 / ' + (s.used / BALLS_PER_1K).toFixed(1) + 'k / '
      + s.hits + '当たり / 差玉<span style="color:' + (diff >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') + '">'
      + (diff >= 0 ? '+' : '') + diff.toLocaleString() + '</span>'
      + (s.cash ? ' / 投資' + s.cash.toLocaleString() + '円' : '')
      + '</div>';

    main.innerHTML = head + sub;
    if (s.memo) {
      const memo = document.createElement('div');
      memo.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:2px;word-break:break-all;';
      memo.textContent = s.memo;
      main.appendChild(memo);
    }

    const del = document.createElement('button');
    del.textContent = '🗑';
    del.style.cssText = 'background:none;border:none;color:var(--accent-red);font-size:16px;padding:4px 8px;cursor:pointer;flex-shrink:0;';
    del.addEventListener('click', () => {
      const cur = loadSavedMachines();
      savedDeleted = { item: cur[i], index: i };
      cur.splice(i, 1);
      storeSavedMachines(cur);
      renderSavedMachines();
    });

    row.appendChild(main);
    row.appendChild(del);
    box.appendChild(row);
  });

  appendSavedUndo(box);
}

// 直前に削除した台を戻すボタン
function appendSavedUndo(box) {
  if (savedDeleted) {
    const undo = document.createElement('button');
    undo.className = 'btn btn-sm';
    undo.style.cssText = 'background:transparent;border:1px solid var(--accent-green);color:var(--accent-green);margin-top:10px;';
    undo.textContent = '↩ 削除した台を元に戻す';
    undo.addEventListener('click', () => {
      const cur = loadSavedMachines();
      cur.splice(Math.min(savedDeleted.index, cur.length), 0, savedDeleted.item);
      savedDeleted = null;
      storeSavedMachines(cur);
      renderSavedMachines();
    });
    box.appendChild(undo);
  }
}

// ===== 開始値の修正 =====
function openStartEditModal() {
  const tab = getTab();
  if (!tab.started) return;
  document.getElementById('se-rot').value = tab.startRot;
  // 内訳は保存していないので、貯玉は前回値・残りを持ち玉として表示
  const cho = Math.min(tab.lastChodama || 0, tab.startBalls);
  document.getElementById('se-cho').value = cho > 0 ? cho : '';
  document.getElementById('se-mochi').value = tab.startBalls - cho;
  document.getElementById('se-total').textContent = tab.startBalls.toLocaleString();
  clearError('se-error');
  document.getElementById('startedit-modal').classList.add('open');
}

function closeStartEditModal() {
  document.getElementById('startedit-modal').classList.remove('open');
}

// 開始値を変えて、履歴を先頭から積み直す
function handleStartEditConfirm() {
  clearError('se-error');
  const rotVal = document.getElementById('se-rot').value.trim();
  const choVal = document.getElementById('se-cho').value.trim();
  const mochiVal = document.getElementById('se-mochi').value.trim();

  const rot = parseInt(rotVal, 10);
  const cho = choVal === '' ? 0 : parseInt(choVal, 10);
  const mochi = mochiVal === '' ? 0 : parseInt(mochiVal, 10);
  if (isNaN(rot) || isNaN(cho) || isNaN(mochi) || rot < 0 || cho < 0 || mochi < 0) {
    showError('se-error', '正しい数値を入力してください');
    return;
  }
  const balls = cho + mochi;

  const tab = getTab();
  tab.startRot = rot;
  tab.startBalls = balls;
  tab.lastChodama = cho;
  recalcFromStart(tab);

  closeStartEditModal();
  saveState();
  renderSessionView(tab);
}

// 開始値から履歴を順に適用して累計を作り直す
function recalcFromStart(tab) {
  let prevRot = tab.startRot;
  let prevBalls = tab.startBalls;
  let totalRot = 0;
  let totalUsed = 0;

  tab.history.forEach(h => {
    // この当たりの区間を開始値基準で計算し直す
    h.snapPrevRot = prevRot;
    h.snapPrevBalls = prevBalls;
    h.snapTotalRot = totalRot;
    h.snapTotalUsed = totalUsed;

    const secRot = h.hitRot - prevRot;
    const secUsedBalls = prevBalls - h.hitBalls;
    h.secRot = secRot;
    h.secUsedBalls = secUsedBalls;
    h.usedK = secUsedBalls > 0 ? (secUsedBalls / BALLS_PER_1K).toFixed(1) : null;
    h.secRate = (secRot > 0 && secUsedBalls > 0)
      ? Math.round(secRot / (secUsedBalls / BALLS_PER_1K) * 10) / 10 : null;
    h.gained = h.payoutBalls - h.hitBalls;
    h.per1r = (h.r && h.r > 0) ? h.gained / h.r : null;

    if (secRot > 0) totalRot += secRot;
    if (secUsedBalls > 0) totalUsed += secUsedBalls;

    prevRot = (h.endRot !== undefined && h.endRot !== null) ? h.endRot : h.hitRot;
    prevBalls = h.payoutBalls;
  });

  tab.totalRot = totalRot;
  tab.totalUsed = totalUsed;

  if (tab.isHit) {
    // 当たり入力中は直前の区間だけ基準を更新
    tab.hitPrevRot = prevRot;
    tab.hitPrevBalls = prevBalls;
  } else {
    tab.prevRot = prevRot;
    tab.prevBalls = prevBalls;
    tab.curRot = prevRot;
    tab.curBalls = prevBalls;
  }
  const last = tab.history[tab.history.length - 1];
  tab.lastSecRate = last && last.secRate !== null ? last.secRate : null;
}

// ===== 履歴編集モーダル =====
let pendingEditIndex = null;
let pendingChoTarget = null;

// 持ち玉欄に入力があったら、貯玉欄が空なら前回貯玉を自動入力
function autoFillChodamaOnMochi(choId, mochiId, totalId) {
  const mochiEl = document.getElementById(mochiId);
  const choEl = document.getElementById(choId);
  const updateTotal = () => {
    if (totalId) {
      const cho = parseInt(choEl.value, 10) || 0;
      const mochi = parseInt(mochiEl.value, 10) || 0;
      document.getElementById(totalId).textContent = (cho + mochi).toLocaleString();
    }
  };
  mochiEl.addEventListener('input', () => {
    if (mochiEl.value.trim() !== '' && choEl.value.trim() === '') {
      const t = getTab();
      if (t.lastChodama > 0) {
        choEl.value = t.lastChodama;
      }
    }
    updateTotal();
  });
  choEl.addEventListener('input', updateTotal);
}

function openEditModal(idx) {
  const tab = getTab();
  const h = tab.history[idx];
  pendingEditIndex = idx;
  document.getElementById('edit-hit-rot').value = h.hitRot;
  // 貯玉/持ち玉の内訳（古い履歴は内訳がないので合計を持ち玉側に入れる）
  const hCho = h.hitCho || 0;
  const hMochi = (h.hitMochi !== undefined && h.hitMochi !== null) ? h.hitMochi : (h.hitBalls - hCho);
  const pCho = h.payoutCho || 0;
  const pMochi = (h.payoutMochi !== undefined && h.payoutMochi !== null) ? h.payoutMochi : (h.payoutBalls - pCho);
  document.getElementById('edit-hit-cho').value = hCho > 0 ? hCho : '';
  document.getElementById('edit-hit-mochi').value = hMochi;
  document.getElementById('edit-hit-total').textContent = h.hitBalls.toLocaleString();
  document.getElementById('edit-payout-cho').value = pCho > 0 ? pCho : '';
  document.getElementById('edit-payout-mochi').value = pMochi;
  document.getElementById('edit-payout-total').textContent = h.payoutBalls.toLocaleString();
  document.getElementById('edit-endrot').value = h.endRot !== undefined && h.endRot !== null ? h.endRot : '';
  document.getElementById('edit-r').value = h.r !== undefined && h.r !== null ? h.r : '';
  clearError('edit-error');
  document.getElementById('edit-modal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
  clearDraft();
  pendingEditIndex = null;
}

function handleEditConfirm() {
  if (pendingEditIndex === null) return;
  clearError('edit-error');

  const hitRot = parseInt(document.getElementById('edit-hit-rot').value.trim(), 10);
  const hitChoVal = document.getElementById('edit-hit-cho').value.trim();
  const hitMochiVal = document.getElementById('edit-hit-mochi').value.trim();
  const payoutChoVal = document.getElementById('edit-payout-cho').value.trim();
  const payoutMochiVal = document.getElementById('edit-payout-mochi').value.trim();
  const endRotVal = document.getElementById('edit-endrot').value.trim();
  const rVal = document.getElementById('edit-r').value.trim();

  const hitCho = hitChoVal === '' ? 0 : parseInt(hitChoVal, 10);
  const hitMochi = hitMochiVal === '' ? 0 : parseInt(hitMochiVal, 10);
  const hitBalls = hitCho + hitMochi;
  const payoutCho = payoutChoVal === '' ? 0 : parseInt(payoutChoVal, 10);
  const payoutMochi = payoutMochiVal === '' ? 0 : parseInt(payoutMochiVal, 10);
  const payoutBalls = payoutCho + payoutMochi;

  if (isNaN(hitRot) || isNaN(hitCho) || isNaN(hitMochi) || isNaN(payoutCho) || isNaN(payoutMochi)) {
    showError('edit-error', '回転数と玉数を正しく入力してください');
    return;
  }
  if (endRotVal === '') {
    showError('edit-error', '時短終了後の回転数を入力してください');
    return;
  }
  const endRot = parseInt(endRotVal, 10);
  if (isNaN(endRot) || endRot < 0) {
    showError('edit-error', '時短終了後の回転数を正しく入力してください');
    return;
  }

  const tab = getTab();
  const h = tab.history[pendingEditIndex];

  // 古い区間値を累計から引く
  if (h.secRot !== undefined && h.secRot > 0) tab.totalRot = Math.max(0, tab.totalRot - h.secRot);
  if (h.secUsedBalls !== undefined && h.secUsedBalls > 0) tab.totalUsed = Math.max(0, tab.totalUsed - h.secUsedBalls);

  // 新しい値で再計算
  const gained = payoutBalls - hitBalls;
  let per1r = null;
  let r = null;
  if (rVal !== '') {
    const rNum = parseInt(rVal, 10);
    if (!isNaN(rNum) && rNum > 0) { r = rNum; per1r = gained / rNum; }
  }

  const secRot = hitRot - h.snapPrevRot;
  const secUsedBalls = h.snapPrevBalls - hitBalls;
  const usedK = secUsedBalls > 0 ? (secUsedBalls / BALLS_PER_1K).toFixed(1) : null;
  const secRate = (secRot > 0 && secUsedBalls > 0)
    ? Math.round(secRot / (secUsedBalls / BALLS_PER_1K) * 10) / 10 : null;

  // 履歴を更新
  h.hitRot = hitRot;
  h.hitBalls = hitBalls;
  h.hitCho = hitCho;
  h.hitMochi = hitMochi;
  h.payoutBalls = payoutBalls;
  h.payoutCho = payoutCho;
  h.payoutMochi = payoutMochi;
  h.endRot = endRot;
  h.gained = gained;
  h.r = r;
  h.per1r = per1r;
  h.secRot = secRot;
  h.secUsedBalls = secUsedBalls;
  h.usedK = usedK;
  h.secRate = secRate;

  // 新しい区間値を累計に足す
  if (secRot > 0) tab.totalRot += secRot;
  if (secUsedBalls > 0) tab.totalUsed += secUsedBalls;

  // 最新履歴なら現在値も更新
  if (pendingEditIndex === tab.history.length - 1) {
    tab.curRot = endRot;
    tab.prevRot = endRot;
    tab.curBalls = payoutBalls;
    tab.prevBalls = payoutBalls;
  }

  closeEditModal();
  saveState();
  renderSessionView(tab);
}

// ===== 履歴削除モーダル =====
function openDeleteModal(idx) {
  const tab = getTab();
  const h = tab.history[idx];
  pendingDeleteIndex = idx;
  document.getElementById('del-modal-desc').textContent =
    `${h.hitRot}回転 / ${h.gained >= 0 ? '+' : ''}${h.gained.toLocaleString()}玉`;
  document.getElementById('del-modal').classList.add('open');
}

function closeDeleteModal() {
  document.getElementById('del-modal').classList.remove('open');
  pendingDeleteIndex = null;
}

function handleDeleteConfirm() {
  if (pendingDeleteIndex === null) return;
  const tab = getTab();
  const h = tab.history[pendingDeleteIndex];

  // 削除前の状態を丸ごと保存（元に戻す用）
  tab.deletedBackup = {
    history: JSON.parse(JSON.stringify(tab.history)),
    prevRot: tab.prevRot,
    prevBalls: tab.prevBalls,
    curRot: tab.curRot,
    curBalls: tab.curBalls,
    totalRot: tab.totalRot,
    totalUsed: tab.totalUsed,
  };

  // 削除する履歴が最新（末尾）の場合のみprev状態を復元
  if (pendingDeleteIndex === tab.history.length - 1) {
    if (h.snapPrevRot !== undefined) tab.prevRot = h.snapPrevRot;
    if (h.snapPrevBalls !== undefined) tab.prevBalls = h.snapPrevBalls;
    if (h.snapTotalRot !== undefined) tab.totalRot = Math.max(0, h.snapTotalRot);
    if (h.snapTotalUsed !== undefined) tab.totalUsed = Math.max(0, h.snapTotalUsed);
    tab.curRot = h.snapPrevRot !== undefined ? h.snapPrevRot : tab.prevRot;
    tab.curBalls = h.snapPrevBalls !== undefined ? h.snapPrevBalls : tab.prevBalls;
  } else {
    if (h.secRot !== undefined && h.secRot > 0) {
      tab.totalRot = Math.max(0, tab.totalRot - h.secRot);
    }
    if (h.secUsedBalls !== undefined && h.secUsedBalls > 0) {
      tab.totalUsed = Math.max(0, tab.totalUsed - h.secUsedBalls);
    }
  }

  tab.history.splice(pendingDeleteIndex, 1);
  closeDeleteModal();
  saveState();
  renderSessionView(tab);
}

// ===== 削除した履歴を元に戻す =====
function handleRestoreDeleted() {
  const tab = getTab();
  if (!tab.deletedBackup) return;
  const b = tab.deletedBackup;
  tab.history = b.history;
  tab.prevRot = b.prevRot;
  tab.prevBalls = b.prevBalls;
  tab.curRot = b.curRot;
  tab.curBalls = b.curBalls;
  tab.totalRot = b.totalRot;
  tab.totalUsed = b.totalUsed;
  tab.deletedBackup = null;
  saveState();
  renderSessionView(tab);
}

// ===== セッション終了モーダル =====
function openEndModal() {
  const tab = getTab();
  const diffBalls = calcDiff(tab);
  const rate = calcRate(tab.totalRot, tab.totalUsed);
  const speed = calcSpeed(tab);

  const diffEl = document.getElementById('end-diff');
  diffEl.textContent = (diffBalls >= 0 ? '+' : '') + diffBalls.toLocaleString() + '玉';
  diffEl.className = 'value ' + (diffBalls >= 0 ? 'green' : 'red');

  document.getElementById('end-rot').textContent = tab.totalRot.toLocaleString() + '回転';
  document.getElementById('end-used').textContent = (tab.totalUsed / BALLS_PER_1K).toFixed(1) + 'k';
  document.getElementById('end-rate').textContent = rate !== null ? formatRate(rate) + '回転/k' : '---';
  document.getElementById('end-speed').textContent = speed !== null ? speed.toLocaleString() + '回転/h' : '---';

  const rHistories = tab.history.filter(h => h.per1r !== null);
  const avgR = rHistories.length > 0
    ? Math.round(rHistories.reduce((s, h) => s + h.per1r, 0) / rHistories.length) : null;
  const avgRRow = document.getElementById('end-avg1r-row');
  if (avgR !== null) {
    document.getElementById('end-avg1r').textContent = avgR.toLocaleString() + '玉';
    avgRRow.style.display = 'flex';
  } else {
    avgRRow.style.display = 'none';
  }

  const endHist = document.getElementById('end-history');
  endHist.innerHTML = '';
  if (tab.history.length > 0) {
    document.getElementById('end-history-label').style.display = 'block';
    [...tab.history].reverse().forEach(h => {
      const div = document.createElement('div');
      div.className = 'modal-history-item';
      let html = `<span style="color:var(--text-secondary)">${h.hitRot}回転</span>　`;
      html += `<span style="color:var(--accent-green);font-weight:700">${h.gained >= 0 ? '+' : ''}${h.gained.toLocaleString()}玉</span>`;
      if (h.per1r !== null) html += `　<span style="color:var(--accent-yellow);font-size:12px">1R：${Math.round(h.per1r)}玉</span>`;
      div.innerHTML = html;
      endHist.appendChild(div);
    });
  } else {
    document.getElementById('end-history-label').style.display = 'none';
  }

  document.getElementById('end-modal').classList.add('open');
}

function closeEndModal() { document.getElementById('end-modal').classList.remove('open'); }

function handleEndConfirm() {
  const name = getTab().name;
  state.tabs[state.activeTab] = createTabData(name);
  closeEndModal();
  saveState();
  renderAll();
}

// ===== 仮計算モーダル =====
function openTrialModal() {
  document.getElementById('trial-rot').value = '';
  document.getElementById('trial-cho').value = '';
  document.getElementById('trial-mochi').value = '';
  document.getElementById('trial-total').textContent = '0';
  document.getElementById('trial-result').style.display = 'none';
  clearError('trial-error');
  document.getElementById('trial-modal').classList.add('open');
}

function closeTrialModal() { document.getElementById('trial-modal').classList.remove('open'); clearDraft(); }

function handleTrialCalc() {
  const rotVal = document.getElementById('trial-rot').value.trim();
  const choVal = document.getElementById('trial-cho').value.trim();
  const mochiVal = document.getElementById('trial-mochi').value.trim();
  clearError('trial-error');
  if (rotVal === '' || (choVal === '' && mochiVal === '')) { showError('trial-error', '回転数と玉数を入力してください'); return; }
  const rot = parseInt(rotVal, 10);
  const tCho = choVal === '' ? 0 : parseInt(choVal, 10);
  const tMochi = mochiVal === '' ? 0 : parseInt(mochiVal, 10);
  const balls = tCho + tMochi;
  if (isNaN(rot) || isNaN(tCho) || isNaN(tMochi)) { showError('trial-error', '正しい数値を入力してください'); return; }

  const tab = getTab();
  const secRot = rot - tab.prevRot;
  const secUsed = tab.prevBalls - balls;

  document.getElementById('trial-sec-rot').textContent = secRot + '回';
  const secUsedK = secUsed > 0 ? (secUsed / BALLS_PER_1K).toFixed(1) + 'k' : secUsed.toLocaleString() + '玉';
  document.getElementById('trial-sec-used').textContent = secUsedK;

  const secRate = (secRot > 0 && secUsed > 0) ? calcRate(secRot, secUsed) : null;
  const rateRow = document.getElementById('trial-rate-row');
  if (secRate !== null) {
    document.getElementById('trial-rate').textContent = formatRate(secRate) + '回転/k';
    rateRow.style.display = 'flex';
  } else {
    rateRow.style.display = 'none';
  }

  const tmpRot = tab.totalRot + (secRot > 0 && secUsed > 0 ? secRot : secRot > 0 ? secRot : 0);
  const tmpUsed = tab.totalUsed + (secUsed > 0 ? secUsed : 0);
  const totalRate = calcRate(tmpRot, tmpUsed);
  setDiffText(document.getElementById('trial-diff'), calcDiff(tab, balls));
  document.getElementById('trial-total-rate').textContent =
    totalRate !== null ? formatRate(totalRate) + '回転/k' : '---';

  document.getElementById('trial-result').style.display = 'block';
}

// ===== 履歴トグル =====
function toggleHistory() {
  const tab = getTab();
  tab.historyOpen = !tab.historyOpen;
  saveState();
  renderHistory(tab);
}

// ===== イベント登録 =====
function initEvents() {
  document.getElementById('btn-start').addEventListener('click', handleStart);
  document.getElementById('btn-hit').addEventListener('click', openHitModal);
  document.getElementById('btn-kohit').addEventListener('click', openKohitModal);
  document.getElementById('kohit-value-confirm-yes').addEventListener('click', () => {
    pendingKohitConfirmed = true;
    document.getElementById('kohit-value-confirm-modal').classList.remove('open');
    handleKohitConfirm();
  });
  document.getElementById('kohit-value-confirm-no').addEventListener('click', () => {
    pendingKohitConfirmed = false;
    document.getElementById('kohit-value-confirm-modal').classList.remove('open');
  });
  document.getElementById('kohit-detail-toggle').addEventListener('click', () => {
    const fields = document.getElementById('kohit-detail-fields');
    const toggle = document.getElementById('kohit-detail-toggle');
    const isOpen = fields.style.display !== 'none';
    fields.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '詳細設定（出玉280・R数2）▼' : '詳細設定を閉じる ▲';
  });
  document.getElementById('kohit-modal-confirm').addEventListener('click', handleKohitConfirm);
  document.getElementById('kohit-modal-cancel').addEventListener('click', closeKohitModal);
  document.getElementById('kohit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeKohitModal(); });
  document.getElementById('btn-hit-undo').addEventListener('click', handleHitUndo);

  document.getElementById('btn-end').addEventListener('click', () => {
    document.getElementById('end-rot-input').value = '';
    document.getElementById('end-cho-input').value = '';
    document.getElementById('end-mochi-input').value = '';
    document.getElementById('end-total').textContent = '0';
    document.getElementById('end-confirm-modal').classList.add('open');
  });
  document.getElementById('end-confirm-yes').addEventListener('click', () => {
    const tab = getTab();
    const choVal = document.getElementById('end-cho-input').value.trim();
    const mochiVal = document.getElementById('end-mochi-input').value.trim();
    const endRotVal = document.getElementById('end-rot-input').value.trim();

    // 終了時の玉数を反映（空欄なら現在の持ち玉を使用）
    let finalBalls = tab.curBalls;
    if (choVal !== '' || mochiVal !== '') {
      const cho = choVal === '' ? 0 : parseInt(choVal, 10);
      const mochi = mochiVal === '' ? 0 : parseInt(mochiVal, 10);
      if (!isNaN(cho) && !isNaN(mochi)) finalBalls = cho + mochi;
    }

    // 最終回転数が入力されていれば最終区間を累計に加算
    if (endRotVal !== '') {
      const endRot = parseInt(endRotVal, 10);
      if (!isNaN(endRot) && endRot > tab.prevRot) {
        const secRot = endRot - tab.prevRot;
        const secUsed = tab.prevBalls - finalBalls;
        if (secRot > 0) tab.totalRot += secRot;
        if (secUsed > 0) tab.totalUsed += secUsed;
        tab.curRot = endRot;
        tab.prevRot = endRot;
      }
    }
    tab.curBalls = finalBalls;
    tab.prevBalls = finalBalls;
    saveState();

    document.getElementById('end-confirm-modal').classList.remove('open');
    clearDraft();
    openEndModal();
  });
  document.getElementById('end-confirm-no').addEventListener('click', () => {
    document.getElementById('end-confirm-modal').classList.remove('open');
    clearDraft();
  });
  // 終了モーダルの合計表示
  document.getElementById('btn-trial').addEventListener('click', openTrialModal);
  document.getElementById('btn-cash').addEventListener('click', openCashModal);
  document.getElementById('cash-plus').addEventListener('click', handleCashPlus);
  document.getElementById('cash-minus').addEventListener('click', handleCashMinus);
  document.getElementById('cash-close').addEventListener('click', closeCashModal);
  document.getElementById('cash-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeCashModal(); });
  document.getElementById('history-toggle').addEventListener('click', toggleHistory);

  // 当たりサマリー詳細トグル
  document.getElementById('hit-detail-toggle').addEventListener('click', () => {
    const detail = document.getElementById('hit-detail');
    const btn = document.getElementById('hit-detail-toggle');
    const open = detail.style.display === 'none';
    detail.style.display = open ? 'block' : 'none';
    btn.textContent = open ? '詳細 ▲' : '詳細 ▼';
  });

  // 当たり記録モーダル
  document.getElementById('hit-modal-confirm').addEventListener('click', handleHitConfirm);
  document.getElementById('hit-modal-cancel').addEventListener('click', closeHitModal);
  document.getElementById('hit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeHitModal(); });

  // 仮計算モーダル
  document.getElementById('trial-calc').addEventListener('click', handleTrialCalc);
  document.getElementById('trial-close').addEventListener('click', closeTrialModal);
  document.getElementById('trial-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeTrialModal(); });

  // 出玉確定モーダル
  document.getElementById('payout-confirm').addEventListener('click', handlePayoutConfirm);
  document.getElementById('payout-cancel').addEventListener('click', () => {
    // 出玉入力キャンセル = 当たり記録も取り消す
    closePayoutModal();
    handleHitUndo();
  });
  // 出玉入力モーダルは外タップで閉じない（入力必須）

  // セッション終了モーダル
  document.getElementById('end-confirm').addEventListener('click', handleEndConfirm);
  document.getElementById('end-cancel').addEventListener('click', closeEndModal);
  document.getElementById('end-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEndModal(); });

  // 履歴削除モーダル
  document.getElementById('del-confirm').addEventListener('click', handleDeleteConfirm);
  document.getElementById('btn-restore-deleted').addEventListener('click', handleRestoreDeleted);

  // 台の記録
  document.getElementById('btn-save-machine').addEventListener('click', saveCurrentMachine);
  document.getElementById('saved-toggle').addEventListener('click', () => {
    savedOpen = !savedOpen;
    renderSavedMachines();
  });

  // 開始値の修正
  document.getElementById('start-edit-tap').addEventListener('click', openStartEditModal);
  document.getElementById('se-confirm').addEventListener('click', handleStartEditConfirm);
  document.getElementById('se-cancel').addEventListener('click', closeStartEditModal);
  document.getElementById('startedit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeStartEditModal(); });
  autoFillChodamaOnMochi('se-cho', 'se-mochi', 'se-total');

  // 履歴編集モーダル
  document.getElementById('edit-confirm').addEventListener('click', handleEditConfirm);
  document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
  document.getElementById('edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditModal(); });

  // 持ち玉入力時に前回貯玉を自動入力
  autoFillChodamaOnMochi('hit-cho-input', 'hit-mochi-input', 'hit-total');
  autoFillChodamaOnMochi('kohit-cho-input', 'kohit-mochi-input', 'kohit-total');
  autoFillChodamaOnMochi('payout-cho-input', 'payout-mochi-input', 'payout-total');
  ['payout-cho-input', 'payout-mochi-input'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePayoutDiff);
  });
  // 獲得出玉の開閉と再計算
  document.getElementById('gain-toggle').addEventListener('click', () => {
    const f = document.getElementById('gain-fields');
    const t = document.getElementById('gain-toggle');
    const open = f.style.display !== 'none';
    f.style.display = open ? 'none' : 'block';
    t.textContent = open ? '＋ 獲得出玉から計算する ▼' : '獲得出玉を使わない ▲';
    if (open) document.getElementById('payout-gain-input').value = '';
    renderGainTotal();
    updatePayoutDiff();
  });
  document.getElementById('payout-gain-input').addEventListener('input', () => {
    renderGainTotal();
    updatePayoutDiff();
  });
  autoFillChodamaOnMochi('trial-cho', 'trial-mochi', 'trial-total');
  autoFillChodamaOnMochi('end-cho-input', 'end-mochi-input', 'end-total');
  autoFillChodamaOnMochi('edit-hit-cho', 'edit-hit-mochi', 'edit-hit-total');
  autoFillChodamaOnMochi('edit-payout-cho', 'edit-payout-mochi', 'edit-payout-total');

  // 貯玉クリアボタン
  document.querySelectorAll('.cho-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingChoTarget = btn.getAttribute('data-target');
      document.getElementById('cho-clear-modal').classList.add('open');
    });
  });
  document.getElementById('cho-clear-yes').addEventListener('click', () => {
    if (pendingChoTarget) {
      const el = document.getElementById(pendingChoTarget);
      if (el) {
        el.value = '';
        el.dispatchEvent(new Event('input'));
      }
    }
    pendingChoTarget = null;
    document.getElementById('cho-clear-modal').classList.remove('open');
  });
  document.getElementById('cho-clear-no').addEventListener('click', () => {
    pendingChoTarget = null;
    document.getElementById('cho-clear-modal').classList.remove('open');
  });
  document.getElementById('cho-clear-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) { pendingChoTarget = null; e.currentTarget.classList.remove('open'); }
  });
  document.getElementById('del-cancel').addEventListener('click', closeDeleteModal);
  document.getElementById('del-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeDeleteModal(); });

  // Enterキー
  ['start-rot', 'start-chodama', 'start-mochidama'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleStart(); });
  });
  ['hit-rot-input', 'hit-cho-input', 'hit-mochi-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleHitConfirm(); });
  });
  ['start-chodama', 'start-mochidama'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateStartTotal);
  });
}

// ===== Service Worker =====
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn('SW:', e));
  }
}

// ===== 画面復帰時のセッション保持 =====
// ===== 入力途中の値を一時保存／復元 =====
const DRAFT_KEY = STORAGE_KEY + '_draft';
// 監視対象の入力欄
const DRAFT_INPUT_IDS = [
  'start-rot', 'start-chodama', 'start-mochidama',
  'hit-rot-input', 'hit-cho-input', 'hit-mochi-input',
  'kohit-rot-input', 'kohit-cho-input', 'kohit-mochi-input',
  'kohit-payout-input', 'kohit-r-input', 'kohit-endrot-input',
  'payout-cho-input', 'payout-mochi-input', 'payout-gain-input', 'payout-endrot-input', 'payout-r-input',
  'trial-rot', 'trial-cho', 'trial-mochi',
  'end-rot-input', 'end-cho-input', 'end-mochi-input',
  'edit-hit-rot', 'edit-hit-cho', 'edit-hit-mochi',
  'edit-payout-cho', 'edit-payout-mochi', 'edit-endrot', 'edit-r',
];
// どのモーダルが開いているか
const DRAFT_MODAL_IDS = ['hit-modal', 'kohit-modal', 'payout-modal', 'trial-modal', 'end-confirm-modal', 'edit-modal'];

// 台ごとに別々の下書きキー
function draftKey(i) {
  return DRAFT_KEY + '_' + (i === undefined ? state.activeTab : i);
}

function saveDraft() {
  try {
    const values = {};
    DRAFT_INPUT_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.value !== '') values[id] = el.value;
    });
    const openModals = DRAFT_MODAL_IDS.filter(id => {
      const el = document.getElementById(id);
      return el && el.classList.contains('open');
    });
    localStorage.setItem(draftKey(), JSON.stringify({
      values, openModals, editIndex: pendingEditIndex, ts: Date.now()
    }));
  } catch (e) {}
}

// 画面上の入力欄を初期値に戻す（台切り替え時に前の台の値が残らないように）
function resetDraftInputs() {
  DRAFT_INPUT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = el.defaultValue || '';
  });
  ['hit-modal-error', 'kohit-modal-error', 'payout-error', 'trial-error', 'edit-error'].forEach(clearError);
  const trialResult = document.getElementById('trial-result');
  if (trialResult) trialResult.style.display = 'none';
  const hitBtn = document.getElementById('hit-modal-confirm');
  if (hitBtn) hitBtn.textContent = '記録する';
}

function closeAllModalsSilently() {
  document.querySelectorAll('.modal-overlay.open').forEach(el => el.classList.remove('open'));
}

function updateAllTotals() {
  [['hit-cho-input','hit-mochi-input','hit-total'],
   ['kohit-cho-input','kohit-mochi-input','kohit-total'],
   ['payout-cho-input','payout-mochi-input','payout-total'],
   ['trial-cho','trial-mochi','trial-total'],
   ['end-cho-input','end-mochi-input','end-total'],
   ['edit-hit-cho','edit-hit-mochi','edit-hit-total'],
   ['edit-payout-cho','edit-payout-mochi','edit-payout-total'],
   ['start-chodama','start-mochidama','start-total']].forEach(([c, m, t]) => {
    const cEl = document.getElementById(c), mEl = document.getElementById(m), tEl = document.getElementById(t);
    if (cEl && mEl && tEl) {
      const cv = parseInt(cEl.value, 10) || 0;
      const mv = parseInt(mEl.value, 10) || 0;
      tEl.textContent = (cv + mv).toLocaleString();
    }
  });
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(draftKey());
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft || !draft.values) return;
    Object.keys(draft.values).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = draft.values[id];
    });
    if (draft.editIndex !== undefined && draft.editIndex !== null) {
      pendingEditIndex = draft.editIndex;
    }
    const tab = getTab();
    (draft.openModals || []).forEach(id => {
      // 編集対象が無くなっていたら開かない
      if (id === 'edit-modal' && (pendingEditIndex === null || !tab.history[pendingEditIndex])) return;
      // 当たり中でないのに出玉確定を開かない
      if (id === 'payout-modal' && !tab.isHit) return;
      const el = document.getElementById(id);
      if (el) el.classList.add('open');
      if (id === 'payout-modal') renderPayoutSection(tab);
    });
    updateAllTotals();
  } catch (e) {}
}

function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch (e) {}
}

function anyDraftModalOpen() {
  return DRAFT_MODAL_IDS.some(id => {
    const el = document.getElementById(id);
    return el && el.classList.contains('open');
  });
}

// ===== 台の切り替え（入力途中でも可） =====
function switchTab(i) {
  if (i === state.activeTab || i < 0 || i >= NUM_TABS) return;
  saveDraft();               // 今の台の入力途中を保存
  closeAllModalsSilently();  // 下書きは消さずに閉じる
  resetDraftInputs();
  pendingEditIndex = null;
  state.activeTab = i;
  saveState();
  renderAll();
  restoreDraft();            // 切り替え先の台の入力途中を復元
  const tab = getTab();
  if (tab.started && tab.isHit && !anyDraftModalOpen()) openPayoutModal();
}

function restoreOnResume() {
  loadState();
  const tab = getTab();
  renderAll();
  // 入力途中の値とモーダル状態を復元
  restoreDraft();
  // 当たり中でモーダルが復元されていなければ出玉モーダルを開く
  if (tab && tab.started && tab.isHit && !anyDraftModalOpen()) openPayoutModal();
}

// 全入力欄の変更を随時保存
function initDraftWatchers() {
  DRAFT_INPUT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', saveDraft);
  });
}

document.addEventListener('visibilitychange', () => {
  // バックグラウンドへ行く直前に保存
  if (document.visibilityState === 'hidden') saveDraft();
  if (document.visibilityState === 'visible') restoreOnResume();
});

// bfcache（戻る/ホーム画面復帰）からの復元
window.addEventListener('pageshow', (e) => {
  restoreOnResume();
});

window.addEventListener('pagehide', saveDraft);
window.addEventListener('blur', saveDraft);

// ===== スワイプでタブ切り替え =====
function initSwipe() {
  let startX = 0;
  let startY = 0;
  const app = document.getElementById('app');

  app.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  app.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    // 横方向のスワイプのみ（縦スクロールと区別）
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
      if (dx < 0) switchTab(state.activeTab + 1);      // 左スワイプ → 次の台
      else if (dx > 0) switchTab(state.activeTab - 1); // 右スワイプ → 前の台
    }
  }, { passive: true });
}


// ===== iOS キーボード対策 =====
function initKeyboardFix() {
  const vv = window.visualViewport;
  const spacer = document.createElement('div');
  spacer.id = 'kb-spacer';
  spacer.style.height = '0px';
  document.body.appendChild(spacer);

  const isField = (el) => !!el && !!el.tagName && /^(INPUT|TEXTAREA)$/.test(el.tagName);

  function kbHeight() {
    if (!vv) return 0;
    const h = window.innerHeight - vv.height - vv.offsetTop;
    return h > 80 ? Math.round(h) : 0;
  }
  function ensureVisible(el) {
    if (!isField(el)) return;
    let target = el;
    const f = el.getAttribute('data-kb-follow');
    if (f && document.getElementById(f)) target = document.getElementById(f);
    const r = target.getBoundingClientRect();
    if (!r.height) return;
    const vis = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
    const over = r.bottom + 14 - vis;
    if (over <= 0) return;
    const sheet = el.closest ? el.closest('.modal-sheet') : null;
    if (sheet && sheet.scrollHeight > sheet.clientHeight + 2) sheet.scrollTop += over;
    else window.scrollBy(0, over);
  }
  function apply(doScroll) {
    const kb = kbHeight();
    document.documentElement.style.setProperty('--kb', kb + 'px');
    spacer.style.height = kb ? (kb + 28) + 'px' : '0px';
    if (doScroll && kb) ensureVisible(document.activeElement);
  }
  if (vv) {
    vv.addEventListener('resize', () => apply(true));
    vv.addEventListener('scroll', () => apply(false));
  }
  document.addEventListener('focusin', (e) => {
    if (!isField(e.target)) return;
    setTimeout(() => apply(true), 60);
    setTimeout(() => apply(true), 350);
  });
  // ボタンを押してもキーボードが閉じないようにする（data-blur="1" だけは閉じる）
  document.addEventListener('mousedown', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    const a = document.activeElement;
    if (!isField(a)) return;
    if (t.getAttribute('data-blur') === '1') { a.blur(); return; }
    e.preventDefault();
  }, true);
  apply(false);
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initEvents();
  initSwipe();
  initDraftWatchers();
  initKeyboardFix();
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  renderAll();
  renderSavedMachines();
  restoreDraft();
  registerSW();
});
