import {
  applyStam, createSlots, displaySnapshot, hasTimedProgress, isSlotEnabled, liveStam,
  remainingAfter40, restartIdle, setLabel, setRank, formatClock, saveV2Store,
  getTimerInfo, SL_STAM_MAX, SL_STAM_STEP_MS, SL_ORB_MAX, SL_ORB_STEP_MS, formatSLDuration,
  applyStamina, applyFullRecovery, parseFullRecoveryInput, hasSLTimedProgress
} from './lunaby-core.mjs';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const escape = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

  // starleap API を従来の namespace形に束ねる（呼び出し側の差分を最小化）
  const slRuntime = {
    getTimerInfo, SL_STAM_MAX, SL_STAM_STEP_MS, SL_ORB_MAX, SL_ORB_STEP_MS, formatSLDuration,
    applyStamina, applyFullRecovery, parseFullRecoveryInput, hasSLTimedProgress
  };

  let state = { slots:createSlots(), sl:null };
  let storageEnvelope = {};
  let refs = [];
  let selected = null;
  let edit = null;
  let slEdit = null;
  let pageEl = null;
  let slRefs = null;
  const slSnapshot = { stamina:{}, orb:{} };
  let refreshTimer = null;
  let lastResumeSyncAt = -Infinity;
  function applyLoaded(loaded){ storageEnvelope = loaded.envelope; state.slots = loaded.slots; state.sl = loaded.sl; }

  function write(index){
    try { saveV2Store(localStorage, storageEnvelope, state.slots, index, state.sl); } catch (_) {}
  }
  function writeSL(){ try { saveV2Store(localStorage, storageEnvelope, state.slots, undefined, state.sl); } catch (_) {} }
  function slMarkup(){
    return '<section class="starleap-line" aria-label="スターリープ">'
      + '<span class="sl-item" data-sl-task="stamina" aria-label="討伐依頼">'
      + '<span class="sl-main"><span class="sl-cur"><span class="sl-value" data-sl-value="stamina"></span>'
      + '<input class="sl-edit" data-sl-editor="stamina" type="tel" inputmode="numeric" autocomplete="off" hidden></span>'
      + '<span class="sl-max" data-sl-max="stamina"></span></span>'
      + '<span class="sl-plan-wrap"><span class="sl-plan" data-sl-plan="stamina"></span></span></span>'
      + '<span class="sl-item" data-sl-task="orb" aria-label="御大樹の恵み">'
      + '<span class="sl-main"><span class="sl-value" data-sl-value="orb"></span></span>'
      + '<span class="sl-plan-wrap"><span class="sl-plan" data-sl-plan="orb"></span>'
      + '<input class="sl-edit" data-sl-editor="orb" type="text" inputmode="numeric" autocomplete="off" hidden></span></span>'
      + '</section>';
  }
  function setHidden(element, value){ if (!element) return; const hidden = !!value; if (element.hidden !== hidden) element.hidden = hidden; }
  function setClass(element, name, value){ if (!element) return; const enabled = !!value; if (element.classList.contains(name) !== enabled) element.classList.toggle(name, enabled); }
  function refreshSLItem(ref, isEditing, value, plan, maxText){
    setClass(ref.root,'is-selected',isEditing);
    if (ref.max) {
      // スタミナ: 現在値セルに透明inputを重ねる（/max・計画は固定）
      setHidden(ref.value, isEditing);
      setHidden(ref.input, !isEditing);
      if (!isEditing) setText(ref.value, value);
      setText(ref.max, maxText || '');
      setText(ref.plan, plan);
    } else {
      // オーブ: 玉は固定。計画セルに透明inputを重ねる
      setText(ref.value, value);
      setHidden(ref.plan, isEditing);
      setHidden(ref.input, !isEditing);
      if (!isEditing) setText(ref.plan, plan);
    }
  }
  function refreshSL(now){
    if (!slRuntime || !slRefs || !state.sl) return;
    const { getTimerInfo, SL_STAM_MAX, SL_STAM_STEP_MS, SL_ORB_MAX, SL_ORB_STEP_MS, formatSLDuration } = slRuntime;
    const stamina = getTimerInfo(state.sl.stamina, SL_STAM_MAX, SL_STAM_STEP_MS, now, slSnapshot.stamina);
    const orb = getTimerInfo(state.sl.orb, SL_ORB_MAX, SL_ORB_STEP_MS, now, slSnapshot.orb);
    refreshSLItem(slRefs.stamina, slEdit==='stamina', String(stamina.current), stamina.running ? formatClock(stamina.fullAt) : (stamina.isFull ? 'MAX' : '—:—'), '/'+SL_STAM_MAX);
    refreshSLItem(slRefs.orb, slEdit==='orb', '●'.repeat(orb.current)+'○'.repeat(SL_ORB_MAX-orb.current), orb.running ? (formatSLDuration(orb.nextIn)+'/'+formatSLDuration(orb.fullIn)) : (orb.isFull ? 'MAX' : '—:—'));
  }
  function beginSLEdit(type){ if(!slRuntime || slEdit) return; selected=null; setPageDimmed(false); slEdit=type; refreshSL(Date.now()); const input=slRefs[type].input; input.value=''; input.focus({preventScroll:true}); }
  function commitSLEdit(){ if(!slRuntime || !slEdit) return; const type=slEdit; const input=slRefs[type].input; const now=Date.now(); if(type==='stamina'){ const digits=String(input.value||'').replace(/[^0-9]/g,''); if(digits) slRuntime.applyStamina(state.sl.stamina,Number(digits),now); } else { const remaining=slRuntime.parseFullRecoveryInput(input.value); if(remaining!==null) slRuntime.applyFullRecovery(state.sl.orb,remaining,now); } slEdit=null; refreshSL(now); scheduleRefresh(); writeSL(); }
  function buildSL(){ const host=document.getElementById('starleap'); if(!host) return; host.innerHTML=slMarkup(); slRefs={}; for(const type of ['stamina','orb']){ const root=host.querySelector('[data-sl-task="'+type+'"]'); slRefs[type]={ root, value:root.querySelector('[data-sl-value]'), input:root.querySelector('[data-sl-editor]'), max:root.querySelector('[data-sl-max]'), plan:root.querySelector('[data-sl-plan]') }; } }

  function accountMarkup(slot, index){
    return '<section class="account group-' + Math.floor(index / 2) + '" data-slot="' + index + '">' +
      '<div class="account-head">' +
        '<span class="name-display" data-name-edit="' + index + '"><span class="name-display-text">' + escape(slot.label || ('スロット ' + (index + 1))) + '</span></span>' +
        '<input class="name-input" data-name-editor="' + index + '" value="' + escape(slot.label) + '" hidden autocomplete="off" spellcheck="false">' +
        '<span class="rank-display" data-rank-edit="' + index + '">Lv.' + slot.rank + '</span>' +
        '<input class="rank-input" data-rank-editor="' + index + '" value="' + slot.rank + '" hidden inputmode="numeric" autocomplete="off" maxlength="3">' +
      '</div>' +
      '<div class="task-row timer-row compact-data" data-i="' + index + '">' +
        '<div class="full-clock full-clock-stam" aria-hidden="true"><span class="full-clock-hour"></span><span class="full-clock-minute"></span></div>' +
        '<div class="full-clock full-clock-idle" aria-hidden="true"><span class="full-clock-hour"></span><span class="full-clock-minute"></span></div>' +
        '<div class="stam-side" data-i="' + index + '" data-task="stam">' +
          '<span class="stam-edit-gap" data-stam-edit="' + index + '" aria-hidden="true"></span>' +
          '<span class="stam-stack" data-stam-confirm="' + index + '">' +
            '<span class="task-max" data-stam-number="' + index + '"></span>' +
            '<span class="stam-edit-zone">' +
              '<span class="stam-current stam-number" data-stam-number="' + index + '"></span>' +
              '<input class="stam-edit" data-stam-editor="' + index + '" type="tel" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="3" hidden>' +
            '</span>' +
          '</span>' +
          '<span class="stam-calc-gap" data-stam-confirm="' + index + '" aria-hidden="true"></span>' +
          '<span class="stam-full" hidden><span class="stam-full-time"><span class="stam-full-hour" data-stam-edit="' + index + '"></span><span class="stam-full-colon" aria-hidden="true">:</span><span class="stam-full-minute" data-stam-confirm="' + index + '"></span></span><span class="stam-full-label" aria-hidden="true"></span></span>' +
        '</div>' +
        '<div class="idle-zone" data-i="' + index + '" data-task="idle">' +
          '<span class="idle-pre" data-stam-confirm="' + index + '" aria-hidden="true"></span>' +
          '<span class="idle-action" data-task="idle" data-i="' + index + '"><strong class="task-value"></strong><span class="task-plan"></span></span>' +
          '<span class="idle-post" data-task="idle" data-i="' + index + '" aria-hidden="true"></span>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function buildStaticList(){
    const list = document.getElementById('list');
    const visibleIndices = state.slots.reduce((indices, slot, index) => { if (isSlotEnabled(slot)) indices.push(index); return indices; }, []);
    list.innerHTML = visibleIndices.map(index => accountMarkup(state.slots[index], index)).join('');
    refs = new Array(state.slots.length);
    for (const index of visibleIndices) {
      const root = list.querySelector('[data-slot="' + index + '"]');
      const stamRow = root.querySelector('.stam-side');
      const idleRow = root.querySelector('.idle-zone');
      refs[index] = {
        root,
        nameDisplay:root.querySelector('[data-name-edit]'), nameDisplayText:root.querySelector('.name-display-text'), nameInput:root.querySelector('[data-name-editor]'),
        rankDisplay:root.querySelector('[data-rank-edit]'), rankInput:root.querySelector('[data-rank-editor]'),
      stamRow, stamNumber:stamRow.querySelector('.stam-number'), stamInput:stamRow.querySelector('[data-stam-editor]'),
        stamMax:stamRow.querySelector('.task-max'), stamSlash:null, stamCalc:stamRow.querySelector('.stam-stack'), stamCalcGap:stamRow.querySelector('.stam-calc-gap'), stamFull:stamRow.querySelector('.stam-full'), stamFullLabel:stamRow.querySelector('.stam-full-label'), stamFullHour:stamRow.querySelector('.stam-full-hour'), stamFullMinute:stamRow.querySelector('.stam-full-minute'),
        stamFullClock:root.querySelector('.full-clock-stam'), stamFullClockHour:root.querySelector('.full-clock-stam .full-clock-hour'), stamFullClockMinute:root.querySelector('.full-clock-stam .full-clock-minute'),
        idleFullClock:root.querySelector('.full-clock-idle'), idleFullClockHour:root.querySelector('.full-clock-idle .full-clock-hour'), idleFullClockMinute:root.querySelector('.full-clock-idle .full-clock-minute'),
        idleRow, idleValue:idleRow.querySelector('.task-value'), idlePlan:idleRow.querySelector('.task-plan'),
        snapshot:{ stam:{ current:0, plan:'—:—' }, idle:{ value:'未開始', plan:'—:—', full:false, low:false } }
      };
    }
  }

  function setText(element, value){
    if (!element) return;
    const text = String(value == null ? '' : value);
    if (element.textContent !== text) element.textContent = text;
  }
  function setSelected(element, value){ setClass(element, 'is-selected', value); }
  function editIs(type, index){ return edit && edit.type === type && edit.index === index; }
  function fullAtLabel(plan){ const [hour, minute] = String(plan || '').trim().split(':'); return /^\d{1,2}$/.test(hour) && /^\d{2}$/.test(minute) ? String(Number(hour)) + ':' + minute : ''; }
  function fullTimeParts(plan){ const [hour, minute] = String(fullAtLabel(plan) || '—:—').split(':'); return { hour:hour || '—', minute:minute || '—' }; }

  // スタミナ行だけ描画（名前・ランク・放置は触らない）
  // includeMax: ランク変更時など最大値の文字も更新する
  // force: 差分スキップせず必ず描画（確定・復帰用）
  // options.snapshot / prev*: 同一 tick で displaySnapshot を二重に呼ばないための受け渡し
  function paintStamRow(index, now, options){
    const ref = refs[index];
    const slot = state.slots[index];
    if (!ref || !slot) return;
    const includeMax = !!(options && options.includeMax);
    const force = !!(options && options.force);
    const busy = editIs('stam', index) || (selected && selected.index === index && selected.task === 'stam');
    const prevCurrent = options && 'prevStamCurrent' in options
      ? options.prevStamCurrent
      : ref.snapshot.stam.current;
    const prevLow = options && 'prevStamLow' in options
      ? !!options.prevStamLow
      : !!ref.snapshot.stam.low;
    const snapshot = options && options.snapshot
      ? options.snapshot
      : displaySnapshot(slot, now, ref.snapshot);
    if (busy && !force) return;
    const stamFull = snapshot.stam.current >= slot.stamMax;
    const wasFull = prevCurrent >= slot.stamMax;
    if (!force && !includeMax && snapshot.stam.current === prevCurrent && stamFull === wasFull && !!snapshot.stam.low === prevLow) return;
    setSelected(ref.stamRow, false);
    setClass(ref.stamFullClock, 'is-selected', false);
    setClass(ref.stamInput.parentElement, 'is-editing', false);
    setHidden(ref.stamInput, true);
    setHidden(ref.stamNumber, stamFull);
    setHidden(ref.stamSlash, stamFull);
    setHidden(ref.stamMax, stamFull);
    setHidden(ref.stamCalc, stamFull);
    setHidden(ref.stamCalcGap, stamFull);
    setHidden(ref.stamFull, !stamFull);
    if (!stamFull) setText(ref.stamNumber, snapshot.stam.current);
    // 最大値はランク変更・初回だけ更新（40計算/手入力確定では触らない）
    if (includeMax) setText(ref.stamMax, slot.stamMax);
    if (stamFull) {
      const stamClock = fullTimeParts(snapshot.stam.plan);
      setText(ref.stamFullHour, stamClock.hour);
      setText(ref.stamFullMinute, stamClock.minute);
      setText(ref.stamFullLabel, '満');
    }
    const stamClock = fullTimeParts(snapshot.stam.plan);
    const stamClockVisible = /^\d{1,2}$/.test(stamClock.hour) && /^\d{2}$/.test(stamClock.minute);
    setHidden(ref.stamFullClock, !stamClockVisible || stamFull);
    if (stamClockVisible && !stamFull) {
      setText(ref.stamFullClockHour, String(stamClock.hour).padStart(2, '0'));
      setText(ref.stamFullClockMinute, stamClock.minute);
    }
    setClass(ref.stamRow, 'is-near-full', snapshot.stam.low);
  }
  // 放置行だけ描画（名前・ランク・スタミナは触らない）
  function paintIdleRow(index, now, options){
    const ref = refs[index];
    const slot = state.slots[index];
    if (!ref || !slot) return;
    const force = !!(options && options.force);
    const busy = selected && selected.index === index && selected.task === 'idle';
    const prevValue = options && 'prevIdleValue' in options
      ? options.prevIdleValue
      : ref.snapshot.idle.value;
    const prevFull = options && 'prevIdleFull' in options
      ? !!options.prevIdleFull
      : !!ref.snapshot.idle.full;
    const prevLow = options && 'prevIdleLow' in options
      ? !!options.prevIdleLow
      : !!ref.snapshot.idle.low;
    const snapshot = options && options.snapshot
      ? options.snapshot
      : displaySnapshot(slot, now, ref.snapshot);
    if (busy && !force) return;
    if (!force && snapshot.idle.value === prevValue && snapshot.idle.full === prevFull && !!snapshot.idle.low === prevLow) return;
    setSelected(ref.idleRow, false);
    setClass(ref.idleFullClock, 'is-selected', false);
    const idleValue = snapshot.idle.value;
    const idleClock = /^\d{1,2}:\d{2}$/.test(idleValue);
    setText(ref.idleValue, idleClock && /^\d:/.test(idleValue) ? '\u2007' + idleValue : idleValue);
    setClass(ref.idleValue, 'is-clock', idleClock);
    setHidden(ref.idleValue, snapshot.idle.full);
    setText(ref.idlePlan, snapshot.idle.full ? fullAtLabel(snapshot.idle.plan) : '');
    setClass(ref.idlePlan, 'is-full', snapshot.idle.full);
    setClass(ref.idleRow, 'is-near-full', snapshot.idle.low);
    const idleFullTime = fullTimeParts(snapshot.idle.plan);
    const idleFullClockVisible = /^\d{1,2}$/.test(idleFullTime.hour) && /^\d{2}$/.test(idleFullTime.minute);
    setHidden(ref.idleFullClock, !idleFullClockVisible || snapshot.idle.full);
    if (idleFullClockVisible && !snapshot.idle.full) {
      setText(ref.idleFullClockHour, String(idleFullTime.hour).padStart(2, '0'));
      setText(ref.idleFullClockMinute, idleFullTime.minute);
    }
  }
  function paintName(index){
    const ref = refs[index];
    const slot = state.slots[index];
    if (!ref || !slot) return;
    setHidden(ref.nameDisplay, false);
    setHidden(ref.nameInput, true);
    setText(ref.nameDisplayText, slot.label || ('スロット ' + (index + 1)));
  }
  function paintRank(index){
    const ref = refs[index];
    const slot = state.slots[index];
    if (!ref || !slot) return;
    setHidden(ref.rankDisplay, false);
    setHidden(ref.rankInput, true);
    setText(ref.rankDisplay, 'Lv.' + slot.rank);
  }
  function scheduleRefresh(){
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    if (document.hidden || edit || slEdit) return;
    const now = Date.now();
    const slTimed = !!(slRuntime && state.sl && slRuntime.hasSLTimedProgress(state.sl, now));
    let dotTimed = false;
    for (let index = 0; index < state.slots.length; index += 1) { if (refs[index] && hasTimedProgress(state.slots[index], now)) { dotTimed = true; break; } }
    if (!dotTimed && !slTimed) return;
    const delay = 60000 - (Date.now() % 60000) + 24;
    refreshTimer = setTimeout(syncTimedSlots, delay);
  }
  function syncTimedSlots(){
    const now = Date.now();
    refreshSL(now);
    for (let index = 0; index < state.slots.length; index += 1) {
      const slot = state.slots[index];
      const ref = refs[index];
      if (!ref) continue;
      if (!slot.idleRunning && !slot.stamRunning) continue;
      // 同一 snapshot を共有するため、更新前の値を先に撮ってから1回だけ displaySnapshot する。
      // （先に放置を描くと stam.current が先に進み、スタミナが「変化なし」でスキップされる不具合を防ぐ）
      const prevStamCurrent = ref.snapshot.stam.current;
      const prevStamLow = !!ref.snapshot.stam.low;
      const prevIdleValue = ref.snapshot.idle.value;
      const prevIdleFull = !!ref.snapshot.idle.full;
      const prevIdleLow = !!ref.snapshot.idle.low;
      const snapshot = displaySnapshot(slot, now, ref.snapshot);
      if (slot.idleRunning) {
        paintIdleRow(index, now, { snapshot, prevIdleValue, prevIdleFull, prevIdleLow });
      }
      if (slot.stamRunning) {
        paintStamRow(index, now, { snapshot, prevStamCurrent, prevStamLow });
      }
    }
    scheduleRefresh();
  }
  // 復帰時：名前/ランクは触らず、動いているタイマー行と SL だけ強制更新
  function syncTimersAfterResume(){
    const now = Date.now();
    if (selected) { selected = null; setPageDimmed(false); }
    if (edit) {
      const idx = edit.index;
      edit = null;
      setPageDimmed(false);
      paintName(idx);
      paintRank(idx);
      paintStamRow(idx, now, { force:true, includeMax:true });
    }
    refreshSL(now);
    for (let index = 0; index < state.slots.length; index += 1) {
      if (!refs[index]) continue;
      const slot = state.slots[index];
      if (slot.stamRunning) paintStamRow(index, now, { force:true });
      if (slot.idleRunning) paintIdleRow(index, now, { force:true });
    }
    scheduleRefresh();
  }
  function syncAfterResume(){
    // Android/iOSでは復帰時に visibilitychange と focus が連続して発火する。
    // 両イベントの役割は残しつつ、近接した同一復帰だけを抑制する。
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastResumeSyncAt < 250) return;
    lastResumeSyncAt = now;
    syncTimersAfterResume();
  }

  function setPageDimmed(value){ if (pageEl) setClass(pageEl, 'is-dimmed', value); }

  function beginEdit(type, index){
    const previous = selected ? selected.index : NaN;
    const previousTask = selected ? selected.task : null;
    if (Number.isFinite(previous)) clearSelectionVisual(previous, previousTask);
    selected = null;
    edit = { type, index, original:type === 'stam' ? liveStam(state.slots[index], Date.now()) : null };
    setPageDimmed(type === 'stam');
    const ref = refs[index];
    if (type === 'name') {
      setHidden(ref.nameDisplay, true);
      setHidden(ref.nameInput, false);
    } else if (type === 'rank') {
      setHidden(ref.rankDisplay, true);
      setHidden(ref.rankInput, false);
    } else {
      // 満表示中でも手入力に入れるよう、満UIを閉じて input を出す
      setHidden(ref.stamFull, true);
      setHidden(ref.stamNumber, true);
      setHidden(ref.stamSlash, false);
      setHidden(ref.stamMax, false);
      setHidden(ref.stamCalc, false);
      setHidden(ref.stamCalcGap, false);
      setHidden(ref.stamInput, false);
      setText(ref.stamMax, state.slots[index].stamMax);
      setClass(ref.stamInput.parentElement, 'is-editing', true);
      setSelected(ref.stamRow, false);
      setClass(ref.stamFullClock, 'is-selected', true);
    }
    const input = type === 'name' ? ref.nameInput : type === 'rank' ? ref.rankInput : ref.stamInput;
    // 名前は既存文字を表示。ランク/スタミナは空欄から入力
    input.value = type === 'name' ? state.slots[index].label : '';
    input.focus({ preventScroll:true });
  }
  function closeEdit(cancel){
    if (!edit) return;
    const active = edit;
    const ref = refs[active.index];
    const input = active.type === 'name' ? ref.nameInput : active.type === 'rank' ? ref.rankInput : ref.stamInput;
    if (!cancel) commitEdit(active, input.value);
    else {
      edit = null;
      setPageDimmed(false);
      if (active.type === 'name') paintName(active.index);
      else if (active.type === 'rank') paintRank(active.index);
      else paintStamRow(active.index, Date.now(), { force:true, includeMax:true });
      scheduleRefresh();
    }
  }
  function commitEdit(active, raw){
    const slot = state.slots[active.index];
    const now = Date.now();
    let changedIndex = null;
    if (active.type === 'name') {
      if (setLabel(slot, raw)) changedIndex = active.index;
      edit = null;
      setPageDimmed(false);
      paintName(active.index);
    } else if (active.type === 'rank') {
      const digits = String(raw || '').replace(/[^0-9]/g, '');
      if (digits) {
        const rank = clamp(Math.floor(num(digits, slot.rank)), 1, 200);
        if (setRank(slot, rank, now)) changedIndex = active.index;
      }
      edit = null;
      setPageDimmed(false);
      paintRank(active.index);
      // ランク変更で最大スタミナ・現在値クランプが変わりうる
      paintStamRow(active.index, now, { force:true, includeMax:true });
    } else {
      const digits = String(raw || '').replace(/[^0-9]/g, '');
      if (digits) {
        const value = clamp(Math.floor(num(digits, active.original)), 0, slot.stamMax);
        applyStam(slot, value, now);
        changedIndex = active.index;
      }
      edit = null;
      setPageDimmed(false);
      // 手入力確定：現在値・満了表示のみ（最大値は変更なし）
      paintStamRow(active.index, now, { force:true });
    }
    scheduleRefresh();
    if (changedIndex != null) write(changedIndex);
  }

  // 1回目タップ：選択表示だけ。解除は paint*Row に任せる。
  function paintIdleSelection(index){
    const ref = refs[index];
    if (!ref) return;
    const snapshot = displaySnapshot(state.slots[index], Date.now(), ref.snapshot);
    setSelected(ref.idleRow, true);
    setClass(ref.idleFullClock, 'is-selected', true);
    if (snapshot.idle.full) {
      setText(ref.idlePlan, '受取');
      setHidden(ref.idleValue, true);
      setClass(ref.idlePlan, 'is-full', true);
    } else if (snapshot.idle.value !== '未開始') {
      setText(ref.idleValue, '受取');
      setClass(ref.idleValue, 'is-clock', false);
      setHidden(ref.idleValue, false);
      setText(ref.idlePlan, '');
    }
  }
  // 40計算待機：基本は現在値＋選択色のみ。
  // 満のときだけ「満UI → 数字プレビュー」の表示切替が必要なので visibility を触る。
  function paintStamSelection(index, previewValue){
    const ref = refs[index];
    if (!ref) return;
    const slot = state.slots[index];
    const snapshot = displaySnapshot(slot, Date.now(), ref.snapshot);
    const stamFull = snapshot.stam.current >= slot.stamMax;
    setSelected(ref.stamRow, true);
    setClass(ref.stamFullClock, 'is-selected', true);
    if (stamFull) {
      setHidden(ref.stamFull, true);
      setHidden(ref.stamNumber, false);
      setHidden(ref.stamSlash, false);
      setHidden(ref.stamMax, false);
      setHidden(ref.stamCalc, false);
      setHidden(ref.stamCalcGap, false);
    }
    setText(ref.stamNumber, previewValue);
  }
  function clearSelectionVisual(index, task){
    if (!Number.isFinite(index) || !refs[index]) return;
    const now = Date.now();
    if (task === 'idle') paintIdleRow(index, now, { force:true });
    else if (task === 'stam') paintStamRow(index, now, { force:true });
  }
  function selectTask(index, task){
    const previousIndex = selected ? selected.index : NaN;
    const previousTask = selected ? selected.task : null;
    const previewValue = task === 'stam'
      ? remainingAfter40(liveStam(state.slots[index], Date.now()))
      : null;
    selected = task === 'stam'
      ? { index, task, value:previewValue }
      : { index, task };
    setPageDimmed(true);
    if (Number.isFinite(previousIndex) && (previousIndex !== index || previousTask !== task)) {
      clearSelectionVisual(previousIndex, previousTask);
    }
    if (task === 'idle') paintIdleSelection(index);
    else paintStamSelection(index, previewValue);
  }
  function confirmTask(index, task){
    const slot = state.slots[index];
    const now = Date.now();
    if (task === 'stam') applyStam(slot, selected.value, now);
    else if (task === 'idle') restartIdle(slot, now);
    // UIを先に確定してから永続化。localStorage が端末で遅いと
    // 保存が終わるまで画面遷移が遅延して体感が悪くなるため。
    selected = null;
    setPageDimmed(false);
    if (task === 'stam') paintStamRow(index, now, { force:true });
    else paintIdleRow(index, now, { force:true });
    scheduleRefresh();
    write(index);
  }
  function activate(index, task){
    const same = selected && selected.index === index && selected.task === task;
    if (!same) selectTask(index, task);
    else confirmTask(index, task);
  }

  function setupEvents(){
    const list = document.querySelector('.page');
    pageEl = list;
    document.addEventListener('contextmenu', event => event.preventDefault());
    document.addEventListener('copy', event => event.preventDefault());
    document.addEventListener('cut', event => event.preventDefault());
    document.addEventListener('selectstart', event => event.preventDefault());
    document.addEventListener('dragstart', event => event.preventDefault());
    // タップで開く4つの「手入力」対象（名前・ランク・スタミナ・スターリープ）を1本の表にまとめる。
    // 判定順・preventDefaultのタイミング・呼び出す関数は元のコードと同一で、繰り返しだけを解消。
    const MANUAL_EDIT_TARGETS = [
      ['[data-name-edit]', el => beginEdit('name', Number(el.dataset.nameEdit))],
      ['[data-rank-edit]', el => beginEdit('rank', Number(el.dataset.rankEdit))],
      ['[data-stam-edit]', el => beginEdit('stam', Number(el.dataset.stamEdit))],
      ['[data-sl-task]', el => beginSLEdit(el.dataset.slTask)],
    ];
    // タップ操作はすべて pointerdown で完結（ドットアビス＋スターリープ共通）。
    // pointerup に分けるとモバイルで focus 脱落・反応遅れが出るため一本化。
    // やることは3種類だけ：① 手入力を開く ② 40計算（確定式） ③ 放置報酬の受取
    list.addEventListener('pointerdown', event => {
      const target = event.target;
      if (target.matches('input')) {
        if (target.matches('[data-name-editor],[data-rank-editor],[data-stam-editor],[data-sl-editor]')) {
          // ここは実際の <input> 自身へのタップなので preventDefault はしない。
          // pointerdown で preventDefault すると、端末によっては直後の focus() が
          // 「素のユーザー操作」と見なされずソフトキーボードが開かないことがあるため。
          target.focus({ preventScroll:true });
        }
        return;
      }
      // ① 手入力（名前／ランク／スタミナ／スターリープ）
      for (const [selector, open] of MANUAL_EDIT_TARGETS) {
        const el = target.closest(selector);
        if (el) {
          // preventDefault で互換マウスイベントを止め、余白への誤ヒット→blur を防ぐ
          event.preventDefault();
          open(el);
          return;
        }
      }
      // ② 40計算（スタミナの確定式タップ）
      const stamConfirm = target.closest('[data-stam-confirm]');
      if (stamConfirm) {
        activate(Number(stamConfirm.dataset.stamConfirm), 'stam');
        return;
      }
      // ③ 放置報酬の受取
      const row = target.closest('[data-task]');
      if (row && row.dataset.task !== 'stam') {
        activate(Number(row.dataset.i), row.dataset.task);
        return;
      }
    });
    list.addEventListener('input', event => {
      const input = event.target;
      if (input.matches('[data-stam-editor]')) { input.value=String(input.value||'').replace(/[^0-9]/g,'').slice(0,3); }
      if (input.matches('[data-rank-editor]')) { input.value=String(input.value||'').replace(/[^0-9]/g,'').slice(0,3); }
      if (input.matches('[data-sl-editor="stamina"]')) input.value=String(input.value||'').replace(/[^0-9]/g,'').slice(0,2);
      if (input.matches('[data-sl-editor="orb"]')) { const raw=String(input.value||'').replace(/：/g,':'); let next=''; let digits=0; for(const char of raw){ if(/\d/.test(char) && digits<4){ next+=char; digits+=1; } else if(char===':' && !next.includes(':')) next+=char; } input.value=next; }
    });
    list.addEventListener('focusout', event => {
      const input = event.target;
      if (slEdit && input.matches('[data-sl-editor]')) { commitSLEdit(); return; }
      if (!edit || !input.matches('input')) return;
      const type = input.matches('[data-name-editor]') ? 'name' : input.matches('[data-rank-editor]') ? 'rank' : input.matches('[data-stam-editor]') ? 'stam' : '';
      if (type !== edit.type || Number(input.dataset[type + 'Editor']) !== edit.index) return;
      closeEdit(false);
    });
    document.addEventListener('pointerdown', event => {
      if (!selected || event.target.closest('[data-task]') || event.target.closest('[data-sl-task]')) return;
      const index = selected.index;
      const task = selected.task;
      selected = null;
      setPageDimmed(false);
      clearSelectionVisual(index, task);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
      } else syncAfterResume();
    });
    window.addEventListener('focus', syncAfterResume);
  }

  export function startLunaby(loaded) {
    applyLoaded(loaded);
    buildStaticList();
    setupEvents();
    buildSL();
    // 初回：名前/ランクは markup 済み。タイマー行と SL だけ埋める。
    // スタミナ最大値はここで一度だけ書く（以降はランク変更時のみ）。
    const now = Date.now();
    refreshSL(now);
    for (let index = 0; index < state.slots.length; index += 1) {
      if (!refs[index]) continue;
      paintStamRow(index, now, { force:true, includeMax:true });
      paintIdleRow(index, now, { force:true });
    }
    scheduleRefresh();
  }
