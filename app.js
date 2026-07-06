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
  const t = getTab();
  document.getElementById('hit-rot-input').value = '';
  document.getElementById('hit-cho-input').value = t.lastChodama > 0 ? t.lastChodama : '';
  document.getElementById('hit-mochi-input').value = '';
  document.getElementById('hit-total').textContent = (t.lastChodama > 0 ? t.lastChodama : 0).toLocaleString();
  clearError('hit-modal-error');
  getTab().rateWarnAcknowledged = false;
  document.getElementById('hit-modal').classList.add('open');
}

function closeHitModal() {
  document.getElementById('hit-modal').classList.remove('open');
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
  const t = getTab();
  document.getElementById('kohit-rot-input').value = '';
  document.getElementById('kohit-cho-input').value = t.lastChodama > 0 ? t.lastChodama : '';
  document.getElementById('kohit-mochi-input').value = '';
  document.getElementById('kohit-total').textContent = (t.lastChodama > 0 ? t.lastChodama : 0).toLocaleString();
  document.getElementById('kohit-payout-input').value = KO_DEFAULT_BALLS;
  document.getElementById('kohit-r-input').value = KO_DEFAULT_R;
  document.getElementById('kohit-endrot-input').value = '';
  clearError('kohit-modal-error');
  document.getElementById('kohit-modal').classList.add('open');
}

function closeKohitModal() {
  document.getElementById('kohit-modal').classList.remove('open');
}

function handleKohitConfirm() {
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
  if (endRotVal !== '' && (isNaN(koEndRot) || koEndRot < rot)) {
    showError('kohit-modal-error', `保留消化後の回転数は当選時(${rot})以上で入力してください`);
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
  document.getElementById('payout-cho-input').value = tab.lastChodama > 0 ? tab.lastChodama : '';
  document.getElementById('payout-mochi-input').value = '';
  document.getElementById('payout-total').textContent = (tab.lastChodama > 0 ? tab.lastChodama : 0).toLocaleString();
  document.getElementById('payout-r-input').value = '';
  document.getElementById('payout-endrot-input').value = '';
  clearError('payout-error');

  // 区間結果を表示（前回〜当たりまでの通常遊技区間）
  const secRot = tab.hitRot - tab.hitPrevRot;
  const secUsedBalls = tab.hitPrevBalls - tab.hitBalls;
  document.getElementById('payout-sec-rot').textContent = secRot > 0 ? secRot + '回' : '---';
  const secUsedK = secUsedBalls > 0 ? (secUsedBalls / BALLS_PER_1K).toFixed(1) + 'k' : '---';
  document.getElementById('payout-sec-used').textContent = secUsedK;
  const secRate = (secRot > 0 && secUsedBalls > 0)
    ? Math.round(secRot / (secUsedBalls / BALLS_PER_1K) * 10) / 10 : null;
  document.getElementById('payout-sec-rate').textContent = secRate !== null ? formatRate(secRate) : '---';

  document.getElementById('payout-modal').classList.add('open');
}

function closePayoutModal() {
  document.getElementById('payout-modal').classList.remove('open');
}

function handlePayoutConfirm() {
  const choVal = document.getElementById('payout-cho-input').value.trim();
  const mochiVal = document.getElementById('payout-mochi-input').value.trim();
  const rVal = document.getElementById('payout-r-input').value.trim();
  const endRotVal = document.getElementById('payout-endrot-input').value.trim();
  clearError('payout-error');

  if (choVal === '' && mochiVal === '') { showError('payout-error', '玉数を入力してください'); return; }
  const cho = choVal === '' ? 0 : parseInt(choVal, 10);
  const mochi = mochiVal === '' ? 0 : parseInt(mochiVal, 10);
  const balls = cho + mochi;
  if (isNaN(cho) || isNaN(mochi) || cho < 0 || mochi < 0) { showError('payout-error', '正しい数値を入力してください'); return; }
  getTab().lastChodama = cho;

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

// ===== 履歴編集モーダル =====
let pendingEditIndex = null;
let pendingChoTarget = null;

function openEditModal(idx) {
  const tab = getTab();
  const h = tab.history[idx];
  pendingEditIndex = idx;
  document.getElementById('edit-hit-rot').value = h.hitRot;
  document.getElementById('edit-hit-balls').value = h.hitBalls;
  document.getElementById('edit-payout-balls').value = h.payoutBalls;
  document.getElementById('edit-endrot').value = h.endRot !== undefined && h.endRot !== null ? h.endRot : '';
  document.getElementById('edit-r').value = h.r !== undefined && h.r !== null ? h.r : '';
  clearError('edit-error');
  document.getElementById('edit-modal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
  pendingEditIndex = null;
}

function handleEditConfirm() {
  if (pendingEditIndex === null) return;
  clearError('edit-error');

  const hitRot = parseInt(document.getElementById('edit-hit-rot').value.trim(), 10);
  const hitBalls = parseInt(document.getElementById('edit-hit-balls').value.trim(), 10);
  const payoutBalls = parseInt(document.getElementById('edit-payout-balls').value.trim(), 10);
  const endRotVal = document.getElementById('edit-endrot').value.trim();
  const rVal = document.getElementById('edit-r').value.trim();

  if (isNaN(hitRot) || isNaN(hitBalls) || isNaN(payoutBalls)) {
    showError('edit-error', '回転数と持ち玉を正しく入力してください');
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
  h.payoutBalls = payoutBalls;
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
  const diffBalls = tab.curBalls - tab.startBalls;
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
  const t = getTab();
  document.getElementById('trial-rot').value = '';
  document.getElementById('trial-cho').value = t.lastChodama > 0 ? t.lastChodama : '';
  document.getElementById('trial-mochi').value = '';
  document.getElementById('trial-total').textContent = (t.lastChodama > 0 ? t.lastChodama : 0).toLocaleString();
  document.getElementById('trial-result').style.display = 'none';
  clearError('trial-error');
  document.getElementById('trial-modal').classList.add('open');
}

function closeTrialModal() { document.getElementById('trial-modal').classList.remove('open'); }

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
  document.getElementById('kohit-modal-confirm').addEventListener('click', handleKohitConfirm);
  document.getElementById('kohit-modal-cancel').addEventListener('click', closeKohitModal);
  document.getElementById('kohit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeKohitModal(); });
  document.getElementById('btn-hit-undo').addEventListener('click', handleHitUndo);

  document.getElementById('btn-end').addEventListener('click', () => {
    document.getElementById('end-cho-input').value = '';
    document.getElementById('end-mochi-input').value = '';
    document.getElementById('end-total').textContent = '0';
    document.getElementById('end-confirm-modal').classList.add('open');
  });
  document.getElementById('end-confirm-yes').addEventListener('click', () => {
    // 終了時の玉数を反映（空欄なら現在の持ち玉を使用）
    const choVal = document.getElementById('end-cho-input').value.trim();
    const mochiVal = document.getElementById('end-mochi-input').value.trim();
    if (choVal !== '' || mochiVal !== '') {
      const cho = choVal === '' ? 0 : parseInt(choVal, 10);
      const mochi = mochiVal === '' ? 0 : parseInt(mochiVal, 10);
      if (!isNaN(cho) && !isNaN(mochi)) {
        const tab = getTab();
        tab.curBalls = cho + mochi;
        saveState();
      }
    }
    document.getElementById('end-confirm-modal').classList.remove('open');
    openEndModal();
  });
  document.getElementById('end-confirm-no').addEventListener('click', () => {
    document.getElementById('end-confirm-modal').classList.remove('open');
  });
  // 終了モーダルの合計表示
  ['end-cho-input', 'end-mochi-input'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const cho = parseInt(document.getElementById('end-cho-input').value, 10) || 0;
      const mochi = parseInt(document.getElementById('end-mochi-input').value, 10) || 0;
      document.getElementById('end-total').textContent = (cho + mochi).toLocaleString();
    });
  });
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

  // 履歴編集モーダル
  document.getElementById('edit-confirm').addEventListener('click', handleEditConfirm);
  document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
  document.getElementById('edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditModal(); });

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
  ['start-rot', 'start-balls'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleStart(); });
  });
  ['hit-rot-input', 'hit-cho-input', 'hit-mochi-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleHitConfirm(); });
  });
  ['start-chodama', 'start-mochidama'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateStartTotal);
  });
  // 当たり記録モーダルの合計表示
  ['hit-cho-input', 'hit-mochi-input'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const cho = parseInt(document.getElementById('hit-cho-input').value, 10) || 0;
      const mochi = parseInt(document.getElementById('hit-mochi-input').value, 10) || 0;
      document.getElementById('hit-total').textContent = (cho + mochi).toLocaleString();
    });
  });
  // 小当たりモーダルの合計表示
  ['kohit-cho-input', 'kohit-mochi-input'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const cho = parseInt(document.getElementById('kohit-cho-input').value, 10) || 0;
      const mochi = parseInt(document.getElementById('kohit-mochi-input').value, 10) || 0;
      document.getElementById('kohit-total').textContent = (cho + mochi).toLocaleString();
    });
  });
  // 出玉確定モーダルの合計表示
  ['payout-cho-input', 'payout-mochi-input'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const cho = parseInt(document.getElementById('payout-cho-input').value, 10) || 0;
      const mochi = parseInt(document.getElementById('payout-mochi-input').value, 10) || 0;
      document.getElementById('payout-total').textContent = (cho + mochi).toLocaleString();
    });
  });
  // 仮計算モーダルの合計表示
  ['trial-cho', 'trial-mochi'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const cho = parseInt(document.getElementById('trial-cho').value, 10) || 0;
      const mochi = parseInt(document.getElementById('trial-mochi').value, 10) || 0;
      document.getElementById('trial-total').textContent = (cho + mochi).toLocaleString();
    });
  });
}

// ===== Service Worker =====
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn('SW:', e));
  }
}

// ===== 画面復帰時のセッション保持 =====
function restoreOnResume() {
  loadState();
  const tab = getTab();
  if (tab && tab.started) {
    renderAll();
    if (tab.isHit) openPayoutModal();
  } else {
    renderAll();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') restoreOnResume();
});

// bfcache（戻る/ホーム画面復帰）からの復元
window.addEventListener('pageshow', (e) => {
  restoreOnResume();
});

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
      if (dx < 0 && state.activeTab < NUM_TABS - 1) {
        // 左スワイプ → 次のタブ
        state.activeTab++;
      } else if (dx > 0 && state.activeTab > 0) {
        // 右スワイプ → 前のタブ
        state.activeTab--;
      } else {
        return;
      }
      saveState();
      renderAll();
    }
  }, { passive: true });
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initEvents();
  initSwipe();
  renderAll();
  registerSW();
});
