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
  let slRefs = null;
  const slSnapshot = { stamina:{}, orb:{} };
  let refreshTimer = null;
  let lastResumeSyncAt = -Infinity;
  function applyLoaded(loaded){ storageEnvelope = loaded.envelope; state.slots = loaded.slots; state.sl = loaded.sl; }

  function write(index){
    try { saveV2Store(localStorage, storageEnvelope, state.slots, index, state.sl); } catch (_) {}
  }
  function writeSL(){ try { saveV2Store(localStorage, storageEnvelope, state.slots, undefined, state.sl); } catch (_) {} }
  function slMarkup(){ return '<section class="starleap-line" aria-label="スターリープ"><span class="sl-item" data-sl-task="stamina" role="button" tabindex="0"><span class="sl-label">討伐依頼</span><span class="sl-value" data-sl-value="stamina"></span><input class="sl-edit" data-sl-editor="stamina" type="tel" inputmode="numeric" autocomplete="off" hidden><span class="sl-plan" data-sl-plan="stamina"></span></span><span class="sl-item" data-sl-task="orb" role="button" tabindex="0"><span class="sl-label">御大樹の恵み</span><span class="sl-value" data-sl-value="orb"></span><input class="sl-edit" data-sl-editor="orb" type="text" inputmode="numeric" autocomplete="off" hidden><span class="sl-plan" data-sl-plan="orb"></span></span></section>'; }
  function setHidden(element, value){ const hidden = !!value; if (element.hidden !== hidden) element.hidden = hidden; }
  function setClass(element, name, value){ const enabled = !!value; if (element.classList.contains(name) !== enabled) element.classList.toggle(name, enabled); }
  function refreshSLItem(ref, isEditing, value, plan){ setHidden(ref.value,isEditing); setHidden(ref.input,!isEditing); if(!isEditing) setText(ref.value,value); setText(ref.plan,isEditing?'':plan); }
  function refreshSL(now){
    if (!slRuntime || !slRefs || !state.sl) return;
    const { getTimerInfo, SL_STAM_MAX, SL_STAM_STEP_MS, SL_ORB_MAX, SL_ORB_STEP_MS, formatSLDuration } = slRuntime;
    const stamina = getTimerInfo(state.sl.stamina, SL_STAM_MAX, SL_STAM_STEP_MS, now, slSnapshot.stamina);
    const orb = getTimerInfo(state.sl.orb, SL_ORB_MAX, SL_ORB_STEP_MS, now, slSnapshot.orb);
    refreshSLItem(slRefs.stamina, slEdit==='stamina', stamina.current+'/'+SL_STAM_MAX, stamina.running ? formatClock(stamina.fullAt) : (stamina.isFull ? 'MAX' : '—:—'));
    refreshSLItem(slRefs.orb, slEdit==='orb', '●'.repeat(orb.current)+'○'.repeat(SL_ORB_MAX-orb.current), orb.running ? ('次 '+formatSLDuration(orb.nextIn)+' / '+formatSLDuration(orb.fullIn)) : (orb.isFull ? 'MAX' : '—:—'));
  }
  function beginSLEdit(type){ if(!slRuntime || slEdit) return; selected=null; slEdit=type; refreshSL(Date.now()); const input=slRefs[type].input; input.value=''; input.focus({preventScroll:true}); }
  function commitSLEdit(){ if(!slRuntime || !slEdit) return; const type=slEdit; const input=slRefs[type].input; const now=Date.now(); if(type==='stamina'){ const digits=String(input.value||'').replace(/[^0-9]/g,''); if(digits) slRuntime.applyStamina(state.sl.stamina,Number(digits),now); } else { const remaining=slRuntime.parseFullRecoveryInput(input.value); if(remaining!==null) slRuntime.applyFullRecovery(state.sl.orb,remaining,now); } slEdit=null; writeSL(); syncAll(); }
  function buildSL(){ const host=document.getElementById('starleap'); if(!host) return; host.innerHTML=slMarkup(); slRefs={}; for(const type of ['stamina','orb']){ const root=host.querySelector('[data-sl-task="'+type+'"]'); slRefs[type]={ root, value:root.querySelector('[data-sl-value]'), input:root.querySelector('[data-sl-editor]'), plan:root.querySelector('[data-sl-plan]') }; } }
  function connectStarLeap(){ buildSL(); }

  function accountMarkup(slot, index){
    return '<section class="account group-' + Math.floor(index / 2) + '" data-slot="' + index + '">' +
      '<div class="account-head">' +
        '<span class="name-display" data-name-edit="' + index + '">' + escape(slot.label || ('スロット ' + (index + 1))) + '</span>' +
        '<input class="name-input" data-name-editor="' + index + '" value="' + escape(slot.label) + '" hidden autocomplete="off" spellcheck="false">' +
        '<span class="rank-display" data-rank-edit="' + index + '" role="button" tabindex="0">Lv.' + slot.rank + '</span>' +
        '<input class="rank-input" data-rank-editor="' + index + '" value="' + slot.rank + '" hidden inputmode="numeric" autocomplete="off">' +
      '</div>' +
      '<div class="task-row timer-row compact-data" data-i="' + index + '">' +
        '<span class="timer-cell stam-cell" data-i="' + index + '" data-task="stam" role="button" tabindex="0">' +
        '<span class="stam-group"><span class="stam-edit-hit" data-stam-edit="' + index + '" aria-hidden="true"></span><span class="stam-current stam-number" data-stam-number="' + index + '" data-stam-edit="' + index + '"></span>' +
        '<input class="stam-edit" data-stam-editor="' + index + '" type="tel" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="3" hidden>' +
        '<span class="stam-full" hidden><span class="stam-full-time"><span class="stam-full-hour" data-stam-edit="' + index + '"></span><span class="stam-full-colon" aria-hidden="true">:</span><span class="stam-full-minute" data-stam-confirm="' + index + '"></span></span><span class="stam-full-label" aria-hidden="true"></span></span><span class="stam-calc-hit" data-stam-confirm="' + index + '"><span class="task-slash">/</span><span class="task-max" data-stam-number="' + index + '"></span></span></span>' +
        '</span>' +
        '<span class="timer-cell idle-cell" data-i="' + index + '" data-task="idle"><span class="idle-action" role="button" tabindex="0"><strong class="task-value"></strong><span class="task-plan"></span></span></span>' +
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
      const stamRow = root.querySelector('.stam-cell');
      const idleRow = root.querySelector('.idle-cell');
      refs[index] = {
        root,
        nameDisplay:root.querySelector('[data-name-edit]'), nameInput:root.querySelector('[data-name-editor]'),
        rankDisplay:root.querySelector('[data-rank-edit]'), rankInput:root.querySelector('[data-rank-editor]'),
      stamRow, stamNumber:stamRow.querySelector('.stam-number'), stamInput:stamRow.querySelector('[data-stam-editor]'),
        stamMax:stamRow.querySelector('.task-max'), stamSlash:stamRow.querySelector('.task-slash'), stamCalc:stamRow.querySelector('.stam-calc-hit'), stamFull:stamRow.querySelector('.stam-full'), stamFullLabel:stamRow.querySelector('.stam-full-label'), stamFullHour:stamRow.querySelector('.stam-full-hour'), stamFullMinute:stamRow.querySelector('.stam-full-minute'),
        idleRow, idleValue:idleRow.querySelector('.task-value'), idlePlan:idleRow.querySelector('.task-plan'),
        snapshot:{ stam:{ current:0, plan:'—:—' }, idle:{ value:'未開始', plan:'—:—', full:false, low:false } }
      };
    }
  }

  function setText(element, value){
    const text = String(value == null ? '' : value);
    if (element.textContent !== text) element.textContent = text;
  }
  function setSelected(element, value){ setClass(element, 'is-selected', value); }
  function editIs(type, index){ return edit && edit.type === type && edit.index === index; }
  function planForIdle(snapshot, index){
    if (!selected || selected.index !== index || selected.task !== 'idle') return snapshot.idle.full ? fullAtLabel(snapshot.idle.plan) : '';
    return snapshot.idle.full ? '受取' : (snapshot.idle.value === '未開始' ? '開始' : '');
  }
  function valueForIdle(snapshot, index){ return selected && selected.index === index && selected.task === 'idle' && !snapshot.idle.full && snapshot.idle.value !== '未開始' ? '受取' : snapshot.idle.value; }
  function fullAtLabel(plan){ const [hour, minute] = String(plan || '').trim().split(':'); return /^\d{1,2}$/.test(hour) && /^\d{2}$/.test(minute) ? String(Number(hour)) + ':' + minute : ''; }
  function fullTimeParts(plan){ const [hour, minute] = String(fullAtLabel(plan) || '—:—').split(':'); return { hour:hour || '—', minute:minute || '—' }; }

  function refreshSlot(index, snapshot){
    const slot = state.slots[index];
    const ref = refs[index];
    const stamSelected = selected && selected.index === index && selected.task === 'stam';
    const idleSelected = selected && selected.index === index && selected.task === 'idle';
    const stamEditing = editIs('stam', index);
    const nameEditing = editIs('name', index);
    const rankEditing = editIs('rank', index);

    setHidden(ref.nameDisplay, nameEditing);
    setHidden(ref.nameInput, !nameEditing);
    if (!nameEditing) setText(ref.nameDisplay, slot.label || ('スロット ' + (index + 1)));
    setHidden(ref.rankDisplay, rankEditing);
    setHidden(ref.rankInput, !rankEditing);
    if (!rankEditing) setText(ref.rankDisplay, 'Lv.' + slot.rank);

    const stamFull = !stamEditing && snapshot.stam.current >= slot.stamMax;
    const stamSelectionPreview = stamFull && stamSelected;
    setHidden(ref.stamNumber, stamEditing || (stamFull && !stamSelectionPreview));
    setHidden(ref.stamInput, !stamEditing);
    setHidden(ref.stamSlash, stamFull && !stamSelectionPreview);
    setHidden(ref.stamMax, stamFull && !stamSelectionPreview);
    setHidden(ref.stamCalc, stamFull && !stamSelectionPreview);
    setHidden(ref.stamFull, !stamFull || stamSelectionPreview);
    if (!stamEditing) setText(ref.stamNumber, stamSelected ? selected.value : snapshot.stam.current);
    if (!stamFull || stamSelectionPreview) setText(ref.stamMax, slot.stamMax);
    if (stamFull) { const fullTime=fullTimeParts(snapshot.stam.plan); setText(ref.stamFullHour, fullTime.hour); setText(ref.stamFullMinute, fullTime.minute); setText(ref.stamFullLabel, ''); }
    setSelected(ref.stamRow, stamSelected);
    setClass(ref.stamRow, 'is-near-full', snapshot.stam.low);
    const idleValue = valueForIdle(snapshot, index);
    setText(ref.idleValue, idleValue);
    setClass(ref.idleValue, 'is-clock', /^\d{1,2}:\d{2}$/.test(idleValue));
    setText(ref.idlePlan, planForIdle(snapshot, index));
    setHidden(ref.idleValue, snapshot.idle.full);
    setClass(ref.idlePlan, 'is-full', snapshot.idle.full);
    setClass(ref.idleRow, 'is-near-full', snapshot.idle.low);
    setSelected(ref.idleRow, idleSelected);
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
  function syncAll(){
    const now = Date.now();
    refreshSL(now);
    for (let index = 0; index < state.slots.length; index += 1) if (refs[index]) refreshSlot(index, displaySnapshot(state.slots[index], now, refs[index].snapshot));
    scheduleRefresh();
  }
  function syncTimedSlots(){
    const now = Date.now();
    refreshSL(now);
    for (let index = 0; index < state.slots.length; index += 1) {
      const slot = state.slots[index];
      if (refs[index] && (slot.stamRunning || slot.idleRunning)) refreshSlot(index, displaySnapshot(slot, now, refs[index].snapshot));
    }
    scheduleRefresh();
  }
  function syncIndices(...indices){
    const now = Date.now();
    for (const index of new Set(indices.filter(Number.isFinite))) if (refs[index]) refreshSlot(index, displaySnapshot(state.slots[index], now, refs[index].snapshot));
  }
  function syncAfterResume(){
    // Android/iOSでは復帰時に visibilitychange と focus が連続して発火する。
    // 両イベントの役割は残しつつ、近接した同一復帰だけを抑制する。
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastResumeSyncAt < 250) return;
    lastResumeSyncAt = now;
    syncAll();
  }

  function beginEdit(type, index){
    const previous = selected ? selected.index : NaN;
    selected = null;
    edit = { type, index, original:type === 'stam' ? liveStam(state.slots[index], Date.now()) : null };
    syncIndices(previous, index);
    const ref = refs[index];
    const input = type === 'name' ? ref.nameInput : type === 'rank' ? ref.rankInput : ref.stamInput;
    input.value = type === 'name' ? state.slots[index].label : type === 'rank' ? String(state.slots[index].rank) : '';
    if (type === 'stam') adjustStamInputWidth(input);
    input.focus({ preventScroll:true });
    if (type === 'name' || type === 'rank') moveCursorToEnd(input);
  }
  function moveCursorToEnd(input){ const apply=()=>{ const end=input.value.length; input.setSelectionRange(end,end); }; apply(); requestAnimationFrame(apply); setTimeout(apply,0); }
  function adjustStamInputWidth(input){ input.style.width = '36px'; }
  function closeEdit(cancel){
    if (!edit) return;
    const active = edit;
    const ref = refs[active.index];
    const input = active.type === 'name' ? ref.nameInput : active.type === 'rank' ? ref.rankInput : ref.stamInput;
    if (!cancel) commitEdit(active, input.value);
    else { edit = null; syncIndices(active.index); scheduleRefresh(); }
  }
  function commitEdit(active, raw){
    const slot = state.slots[active.index];
    if (active.type === 'name') {
      setLabel(slot, raw);
      write(active.index);
    } else if (active.type === 'rank') {
      const rank = clamp(Math.floor(num(String(raw || '').replace(/[^0-9]/g, ''), slot.rank)), 1, 200);
      setRank(slot, rank, Date.now());
      write(active.index);
    } else {
      const digits = String(raw || '').replace(/[^0-9]/g, '');
      if (digits) {
        const value = clamp(Math.floor(num(digits, active.original)), 0, slot.stamMax);
        applyStam(slot, value, Date.now());
        write(active.index);
      }
    }
    edit = null;
    syncAll();
  }

  function selectTask(index, task){
    const previous = selected ? selected.index : NaN;
    selected = task === 'stam'
      ? { index, task, value:remainingAfter40(liveStam(state.slots[index], Date.now())) }
      : { index, task };
    syncIndices(previous, index);
  }
  function confirmTask(index, task){
    const slot = state.slots[index];
    if (task === 'stam') applyStam(slot, selected.value, Date.now());
    else if (task === 'idle') restartIdle(slot, Date.now());
    write(index);
    selected = null;
    syncAll();
  }
  function activate(index, task){
    const same = selected && selected.index === index && selected.task === task;
    if (!same) selectTask(index, task);
    else confirmTask(index, task);
  }

  function setupEvents(){
    const list = document.querySelector('.page');
    document.addEventListener('contextmenu', event => event.preventDefault());
    document.addEventListener('copy', event => event.preventDefault());
    document.addEventListener('cut', event => event.preventDefault());
    document.addEventListener('selectstart', event => event.preventDefault());
    document.addEventListener('dragstart', event => event.preventDefault());
    let touchStartY = 0;
    document.addEventListener('touchstart', event => { touchStartY = event.touches[0] ? event.touches[0].clientY : 0; }, { passive:true });
    document.addEventListener('touchmove', event => { const point = event.touches[0]; if (point && window.scrollY <= 0 && point.clientY > touchStartY) event.preventDefault(); }, { passive:false });
    list.addEventListener('pointerdown', event => { const input=event.target; if (input.matches('[data-name-editor],[data-rank-editor]')) { event.preventDefault(); input.focus({ preventScroll:true }); moveCursorToEnd(input); } });
    list.addEventListener('click', event => {
      const target = event.target;
      if (target.matches('input')) return;
      const name = target.closest('[data-name-edit]');
      if (name) { beginEdit('name', Number(name.dataset.nameEdit)); return; }
      const rank = target.closest('[data-rank-edit]');
      if (rank) { beginEdit('rank', Number(rank.dataset.rankEdit)); return; }
      const stamEdit = target.closest('[data-stam-edit]');
      if (stamEdit) { beginEdit('stam', Number(stamEdit.dataset.stamEdit)); return; }
      const stamConfirm = target.closest('[data-stam-confirm]');
      if (stamConfirm) { activate(Number(stamConfirm.dataset.stamConfirm), 'stam'); return; }
      const sl=target.closest('[data-sl-task]');
      if (sl) { beginSLEdit(sl.dataset.slTask); return; }
      const row = target.closest('[data-task]');
      if (row && row.dataset.task !== 'stam') activate(Number(row.dataset.i), row.dataset.task);
    });
    list.addEventListener('input', event => {
      const input = event.target;
      if (input.matches('[data-stam-editor]')) { input.value=String(input.value||'').replace(/[^0-9]/g,'').slice(0,3); adjustStamInputWidth(input); }
      if (input.matches('[data-sl-editor="stamina"]')) input.value=String(input.value||'').replace(/[^0-9]/g,'').slice(0,2);
      if (input.matches('[data-sl-editor="orb"]')) { const raw=String(input.value||'').replace(/：/g,':'); let next=''; let digits=0; for(const char of raw){ if(/\d/.test(char) && digits<4){ next+=char; digits+=1; } else if(char===':' && !next.includes(':')) next+=char; } input.value=next; }
    });
    list.addEventListener('focusout', event => {
      const input = event.target;
      if (slEdit && input.matches('[data-sl-editor]')) { commitSLEdit(); return; }
      if (!edit || !input.matches('input')) return;
      const type = input.matches('[data-name-editor]') ? 'name' : input.matches('[data-rank-editor]') ? 'rank' : input.matches('[data-stam-editor]') ? 'stam' : '';
      if (type === edit.type && Number(input.dataset[type + 'Editor']) === edit.index) closeEdit(false);
    });
    list.addEventListener('keydown', event => {
      if (!event.target.matches('input')) return;
      if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); if (slEdit) { slEdit=null; syncAll(); } else closeEdit(true); }
    });
    document.addEventListener('pointerdown', event => {
      if (!selected || event.target.closest('[data-task]') || event.target.closest('[data-sl-task]')) return;
      const index = selected.index;
      selected = null;
      syncIndices(index);
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
    connectStarLeap();
    syncAll();
  }
