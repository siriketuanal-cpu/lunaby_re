export function renderV2OnlyGate(onInitialize) {
  const list = document.getElementById('list');
  const starleap = document.getElementById('starleap');
  if (list) {
    list.innerHTML = '<section class="pure-v2-gate" aria-live="polite"><strong>v2専用候補</strong><span>有効なv2保存がないため起動していません。</span><a href="#initialize" data-v2-initialize>初回起動する</a></section>';
    const action = list.querySelector('[data-v2-initialize]');
    if (action && typeof onInitialize === 'function') action.addEventListener('click', event => { event.preventDefault(); onInitialize(); }, { once:true });
  }
  if (starleap) starleap.textContent = '';
}
