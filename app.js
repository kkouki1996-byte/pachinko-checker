// ===== 定数 =====
const BALLS_PER_1K = 250;
const NUM_TABS = 3;
const STORAGE_KEY = 'pachinko_checker_v2';
const MAX_SEC_ROT = 10000;      // 区間回転数の上限（5桁異常値）
const RATE_CHANGE_LIMIT = 10;   // 回転率の警告変動幅

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
    hitSnapshot: null,
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.tabs && parsed.tabs.length === NUM_TABS) state = parsed;
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
function renderTabs() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';
  state.tabs.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (i === state.activeTab ? ' active' : '');
    btn.textContent = tab.name;
    btn.addEventListener('click', () => {
      state.activeTab = i;
      saveState();
      renderAll();
    });
    bar.appendChild(btn);
  });
}

// ===== メイン描画 =====
function renderAll() {
  renderTabs();
  const tab = getTab();
  document.getElementById('start-form').style.display = tab.started ? 'none' : 'block';
  document.getElementById('session-view').style.display = tab.started ? 'block' : 'none';
  if (!tab.started) {
    document.getElementById('start-rot').value = '';
    document.getElementById('start-balls').value = '';
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

  const banner = document.getElementById('hit-banner');
  if (tab.isHit) {
    banner.classList.add('visible');
    banner.textContent = `🎰 当たり中！  ${tab.hitRot}回転 / ${tab.hitBalls.toLocaleString()}玉`;
  } else {
    banner.classList.remove('visible');
  }

  document.getElementById('btn-hit').disabled = tab.isHit;
  document.getElementById('btn-hit-undo').disabled = !tab.isHit;

  renderHistory(tab);
  renderHitSummary(tab);
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
  const toggle = document.getElementById('history-toggle');
  const list = document.getElementById('history-list');
  toggle.textContent = tab.historyOpen ? '履歴 ▲' : '履歴 ▼';
  list.classList.toggle('open', tab.historyOpen);

  list.innerHTML = '';
  if (tab.history.length === 0) {
    list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;text-align:center">履歴なし</div>';
    return;
  }

  // 新しい順（インデックスは元配列基準）
  [...tab.history].reverse().forEach((h, revIdx) => {
    const realIdx = tab.history.length - 1 - revIdx;
    const div = document.createElement('div');
    div.className = 'history-item';
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';

    // 区間情報（使用k / 回転数 / 回転率）
    let subLine = '';
    if (h.usedK !== null && h.usedK !== undefined) subLine += `${h.usedK}k`;
    if (h.secRot !== undefined && h.secRot > 0) subLine += ` / ${h.secRot}回`;
    if (h.secRate !== null && h.secRate !== undefined) subLine += ` / ${h.secRate}回転/k`;

    let info = '';
    if (subLine) {
      info += `<span style="font-size:12px;color:var(--text-secondary)">${subLine}</span><br>`;
    }
    info += `<span class="h-balls" style="font-size:15px">${h.gained >= 0 ? '+' : ''}${h.gained.toLocaleString()}玉</span>`;
    if (h.per1r !== null && h.per1r !== undefined) {
      info += `　<span class="h-1r">1R：${Math.round(h.per1r)}玉</span>`;
    }

    const infoSpan = document.createElement('span');
    infoSpan.innerHTML = info;

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
  const ballsVal = document.getElementById('start-balls').value.trim();
  if (rotVal === '' || ballsVal === '') {
    showError('start-error', '回転数と持ち玉を入力してください');
    return;
  }
  const rot = parseInt(rotVal, 10);
  const balls = parseInt(ballsVal, 10);
  if (isNaN(rot) || isNaN(balls) || rot < 0 || balls < 0) {
    showError('start-error', '正しい数値を入力してください');
    return;
  }
  clearError('start-error');
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
  tab.sessionStart = Date.now();
  tab.historyOpen = false;
  saveState();
  renderAll();
}

// ===== 当たり記録モーダル =====
function openHitModal() {
  document.getElementById('hit-rot-input').value = '';
  document.getElementById('hit-balls-input').value = '';
  clearError('hit-modal-error');
  document.getElementById('hit-modal').classList.add('open');
}

function closeHitModal() {
  document.getElementById('hit-modal').classList.remove('open');
}

function handleHitConfirm() {
  const rotVal = document.getElementById('hit-rot-input').value.trim();
  const ballsVal = document.getElementById('hit-balls-input').value.trim();
  clearError('hit-modal-error');

  if (rotVal === '' || ballsVal === '') {
    showError('hit-modal-error', '回転数と持ち玉を入力してください');
    return;
  }
  const rot = parseInt(rotVal, 10);
  const balls = parseInt(ballsVal, 10);
  if (isNaN(rot) || isNaN(balls) || rot < 0 || balls < 0) {
    showError('hit-modal-error', '正しい数値を入力してください');
    return;
  }

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
            `区間回転率が${newRate.toFixed(1)}回転/k（前回${tab.lastSecRate.toFixed(1)}）と大きく変動しています。問題なければもう一度「記録する」を押してください`);
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
  tab.isHit = true;

  closeHitModal();
  saveState();
  renderSessionView(tab);
  // 即座に出玉入力モーダルへ移行
  openPayoutModal();
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
  document.getElementById('payout-balls-input').value = '';
  document.getElementById('payout-r-input').value = '';
  document.getElementById('payout-endrot-input').value = '';
  clearError('payout-error');
  document.getElementById('payout-modal').classList.add('open');
}

function closePayoutModal() {
  document.getElementById('payout-modal').classList.remove('open');
}

function handlePayoutConfirm() {
  const ballsVal = document.getElementById('payout-balls-input').value.trim();
  const rVal = document.getElementById('payout-r-input').value.trim();
  const endRotVal = document.getElementById('payout-endrot-input').value.trim();
  clearError('payout-error');

  if (ballsVal === '') { showError('payout-error', '持ち玉を入力してください'); return; }
  const balls = parseInt(ballsVal, 10);
  if (isNaN(balls) || balls < 0) { showError('payout-error', '正しい数値を入力してください'); return; }

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

  // 今回の区間回転率を次回の比較用に保存
  if (secRate !== null) tab.lastSecRate = secRate;

  closePayoutModal();
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

  // 削除する履歴が最新（末尾）の場合のみprev状態を復元
  if (pendingDeleteIndex === tab.history.length - 1) {
    if (h.snapPrevRot !== undefined) tab.prevRot = h.snapPrevRot;
    if (h.snapPrevBalls !== undefined) tab.prevBalls = h.snapPrevBalls;
    if (h.snapTotalRot !== undefined) tab.totalRot = Math.max(0, h.snapTotalRot);
    if (h.snapTotalUsed !== undefined) tab.totalUsed = Math.max(0, h.snapTotalUsed);
    tab.curRot = h.snapPrevRot !== undefined ? h.snapPrevRot : tab.prevRot;
    tab.curBalls = h.snapPrevBalls !== undefined ? h.snapPrevBalls : tab.prevBalls;
  } else {
    // 途中の履歴削除は累計のみ差し引く
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

// ===== セッション終了モーダル =====
function openEndModal() {
  const tab = getTab();
  const diffBalls = tab.curBalls - tab.startBalls;
  const rate = calcRate(tab.totalRot, tab.totalUsed);
  const speed = calcSpeed(tab);

  const diffEl = document.getElementById('end-diff');
  diffEl.textContent = (diffBalls >= 0 ? '+' : '') + diffBalls.toLocaleString() + '玉';
  diffEl.className = 'value ' + (diffBalls >= 0 ? 'green' : 'red');

  document.getElementById('end-rot').textContent = tab.totalRot.toLocaleString() + '回転';
  document.getElementById('end-used').textContent = tab.totalUsed.toLocaleString() + '玉';
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
  document.getElementById('trial-balls').value = '';
  document.getElementById('trial-result').style.display = 'none';
  clearError('trial-error');
  document.getElementById('trial-modal').classList.add('open');
}

function closeTrialModal() { document.getElementById('trial-modal').classList.remove('open'); }

function handleTrialCalc() {
  const rotVal = document.getElementById('trial-rot').value.trim();
  const ballsVal = document.getElementById('trial-balls').value.trim();
  clearError('trial-error');
  if (rotVal === '' || ballsVal === '') { showError('trial-error', '回転数と持ち玉を入力してください'); return; }
  const rot = parseInt(rotVal, 10);
  const balls = parseInt(ballsVal, 10);
  if (isNaN(rot) || isNaN(balls)) { showError('trial-error', '正しい数値を入力してください'); return; }

  const tab = getTab();
  const secRot = rot - tab.prevRot;
  const secUsed = tab.prevBalls - balls;

  document.getElementById('trial-sec-rot').textContent = secRot + '回転';
  document.getElementById('trial-sec-used').textContent = secUsed.toLocaleString() + '玉';

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
  document.getElementById('btn-hit-undo').addEventListener('click', handleHitUndo);

  document.getElementById('btn-end').addEventListener('click', openEndModal);
  document.getElementById('btn-trial').addEventListener('click', openTrialModal);
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
  document.getElementById('del-cancel').addEventListener('click', closeDeleteModal);
  document.getElementById('del-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeDeleteModal(); });

  // Enterキー
  ['start-rot', 'start-balls'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleStart(); });
  });
  ['hit-rot-input', 'hit-balls-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleHitConfirm(); });
  });
}

// ===== Service Worker =====
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn('SW:', e));
  }
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initEvents();
  renderAll();
  registerSW();
});
