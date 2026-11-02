import './style.css';

type WikiArticle = { title: string; html: string; url: string };

const app = document.querySelector<HTMLDivElement>('#app')!;
const apiRoot = 'https://cs.wikipedia.org/w/api.php';
let currentTitle = '';
let startTitle = '';
let targetTitle = '';
let clicks = 0;
let startedAt = 0;
let timerId: number | undefined;
let language = 'cs';
let route: string[] = [];
let loading = false;

function wikiUrl(title: string) {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
}

function cleanTitle(title: string) {
  return title.replaceAll('_', ' ').trim();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function renderSetup() {
  app.innerHTML = `
    <main class="setup-shell">
      <header class="topbar"><a class="brand" href="#"><span class="brand-mark">W</span> wiki<span class="brand-light">sprint</span></a><span class="top-note"><i></i> TVŮJ DALŠÍ KLIK MŮŽE BÝT CÍL</span></header>
      <section class="hero">
        <div class="hero-copy"><p class="eyebrow"><span>01</span> WIKIPEDIE, ALE JAKO ZÁVOD</p><h1>Jak rychle<br>najdeš <em>cestu?</em></h1><p class="intro">Začni na jednom článku. Skonči na druhém. Mezitím se můžeš pohybovat jen po odkazech.</p></div>
        <div class="route-card">
          <div class="card-top"><span class="card-label">NASTAV SI TRASU</span><span class="route-icon">↗</span></div>
          <label class="field-label" for="start-input">STARTOVNÍ ČLÁNEK</label>
          <div class="input-wrap"><span class="field-symbol">↗</span><input id="start-input" autocomplete="off" placeholder="např. Praha" value="Praha"></div>
          <div class="route-connector"><span></span><small>TVÁ CESTA</small><span></span></div>
          <label class="field-label" for="target-input">CÍLOVÝ ČLÁNEK</label>
          <div class="input-wrap"><span class="field-symbol target-symbol">◎</span><input id="target-input" autocomplete="off" placeholder="např. Měsíc" value="Měsíc"></div>
          <div class="language-row"><span>JAZYK WIKIPEDIE</span><div class="language-switch"><button class="lang-choice active" data-lang="cs">ČEŠTINA</button><button class="lang-choice" data-lang="en">ENGLISH</button></div></div>
          <button class="start-button" id="start-game"><span>VYRAZIT NA CESTU</span><b>→</b></button>
          <p class="microcopy">Bez vyhledávání během hry. Jen ty a odkazy.</p>
          <p class="form-error" id="form-error" aria-live="polite"></p>
        </div>
      </section>
      <section class="how-row"><div><span class="how-num">01</span><strong>Vyber si trasu</strong><small>Zadej dva články Wikipedie.</small></div><div><span class="how-num">02</span><strong>Proklikávej se</strong><small>Každý odkaz je další krok.</small></div><div><span class="how-num">03</span><strong>Doraz do cíle</strong><small>Sleduj čas i počet kliknutí.</small></div><div class="how-aside">WIKIPEDIE JE VĚTŠÍ,<br>NEŽ SI MYSLÍŠ. <span>↗</span></div></section>
      <footer class="site-footer"><span>© WIKI SPRINT</span><span>POSTAVENO ZVĚDAVOSTÍ <b>✳</b></span></footer>
    </main>`;
  const startInput = app.querySelector<HTMLInputElement>('#start-input')!;
  const targetInput = app.querySelector<HTMLInputElement>('#target-input')!;
  app.querySelectorAll<HTMLButtonElement>('.lang-choice').forEach((button) => button.addEventListener('click', () => {
    language = button.dataset.lang ?? 'cs';
    app.querySelectorAll('.lang-choice').forEach((choice) => choice.classList.toggle('active', choice === button));
  }));
  app.querySelector<HTMLButtonElement>('#start-game')!.addEventListener('click', () => {
    const start = cleanTitle(startInput.value);
    const target = cleanTitle(targetInput.value);
    const error = app.querySelector<HTMLParagraphElement>('#form-error')!;
    if (!start || !target) { error.textContent = 'Vyplň oba články a můžeš vyrazit.'; return; }
    if (start.toLocaleLowerCase() === target.toLocaleLowerCase()) { error.textContent = 'Start a cíl musí být dva různé články.'; return; }
    startTitle = start;
    targetTitle = target;
    clicks = 0;
    route = [start];
    startedAt = Date.now();
    renderGame();
    void loadArticle(start, false);
  });
  [startInput, targetInput].forEach((input) => input.addEventListener('keydown', (event) => { if (event.key === 'Enter') app.querySelector<HTMLButtonElement>('#start-game')!.click(); }));
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function renderGame() {
  app.innerHTML = `
    <main class="game-shell">
      <header class="game-topbar"><button class="back-button" id="quit-game" aria-label="Zpět">←</button><a class="brand" href="#"><span class="brand-mark">W</span> wiki<span class="brand-light">sprint</span></a><div class="game-status"><i></i> PROBÍHÁ HRA</div><button class="give-up" id="give-up">VZDÁT TO <span>↗</span></button></header>
      <div class="game-layout">
        <section class="wiki-panel"><div class="browser-bar"><span class="browser-dots"><i></i><i></i><i></i></span><div class="browser-address"><span>⌕</span><span class="address-text">cs.wikipedia.org/wiki/${escapeHtml(startTitle.replaceAll(' ', '_'))}</span><button id="open-original" title="Otevřít originál">↗</button></div><button class="reload-article" id="reload-article" title="Obnovit článek">↻</button></div><div id="article-content" class="article-content"><div class="article-loading"><span class="loader"></span><p>NAČÍTÁM WIKIPEDII…</p></div></div></section>
        <aside class="hud"><div class="hud-heading"><span>TVŮJ ZÁVOD</span><span class="hud-live"><i></i> LIVE</span></div>
          <div class="timer-card"><div class="timer-label">UPLYNULÝ ČAS</div><div id="timer" class="timer">00:00</div><div class="timer-foot"><span class="pulse-dot"></span> ČAS BĚŽÍ</div></div>
          <div class="goal-card"><span class="goal-kicker">DOSTAŇ SE NA ČLÁNEK</span><div class="goal-title" id="goal-title">${escapeHtml(targetTitle)}</div><a id="goal-link" href="${wikiUrl(targetTitle)}" target="_blank" rel="noreferrer">ZOBRAZIT ČLÁNEK <span>↗</span></a></div>
          <div class="stats-row"><div class="stat-card"><span>PROKLIKNUTÍ</span><strong id="click-count">00</strong></div><div class="stat-card"><span>ČLÁNKY</span><strong id="article-count">01</strong></div></div>
          <div class="route-card-small"><div class="route-small-title">TVOJE TRASA <span>↗</span></div><ol id="route-list"><li><i class="route-dot start-dot"></i><span class="route-item">${escapeHtml(startTitle)}</span><b>START</b></li></ol></div>
          <div class="tip-card"><span>✳</span><p><b>TIP NA CESTU</b><br>Hledej v článku souvislosti. Odkaz, který potřebuješ, může být blíž, než čekáš.</p></div>
          <button class="new-game" id="new-game">NOVÁ HRA <span>↗</span></button>
        </aside>
      </div>
      <footer class="game-footer"><span>WIKI SPRINT <b>✳</b></span><span>ČLÁNKY POSKYTUJE WIKIPEDIE</span><span id="current-language">${language === 'cs' ? 'ČESKÁ' : 'ANGLICKÁ'} VERZE</span></footer>
      <div id="result-overlay" class="result-overlay hidden" role="dialog" aria-modal="true"></div>
    </main>`;
  if (timerId) window.clearInterval(timerId);
  timerId = window.setInterval(() => {
    const timer = app.querySelector<HTMLDivElement>('#timer');
    if (timer) timer.textContent = formatTime(Math.floor((Date.now() - startedAt) / 1000));
  }, 250);
  app.querySelector('#quit-game')!.addEventListener('click', () => confirmExit());
  app.querySelector('#give-up')!.addEventListener('click', () => showResult(false));
  app.querySelector('#new-game')!.addEventListener('click', () => confirmExit());
  app.querySelector('#reload-article')!.addEventListener('click', () => { if (currentTitle) void loadArticle(currentTitle, false); });
  app.querySelector('#open-original')!.addEventListener('click', () => window.open(wikiUrl(currentTitle || startTitle), '_blank', 'noopener,noreferrer'));
}

async function loadArticle(title: string, isClick: boolean) {
  if (loading) return;
  loading = true;
  const content = app.querySelector<HTMLDivElement>('#article-content');
  const address = app.querySelector<HTMLSpanElement>('.address-text');
  if (!content) { loading = false; return; }
  content.innerHTML = '<div class="article-loading"><span class="loader"></span><p>NAČÍTÁM ČLÁNEK…</p></div>';
  try {
    const endpoint = `https://${language}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text%7Cdisplaytitle&format=json&origin=*&redirects=1`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Nepodařilo se spojit s Wikipedií.');
    const data = await response.json() as { parse?: { title: string; text: { '*': string }; displaytitle: string }; error?: { info: string } };
    if (!data.parse) throw new Error(data.error?.info ?? 'Článek se nepodařilo najít. Zkontroluj jeho název.');
    const parsed: WikiArticle = { title: data.parse.title, html: data.parse.text['*'], url: wikiUrl(data.parse.title) };
    currentTitle = parsed.title;
    if (address) address.textContent = `${language}.wikipedia.org/wiki/${parsed.title.replaceAll(' ', '_')}`;
    content.innerHTML = `<div class="wiki-content"><div class="wiki-brand"><span class="wiki-globe">◎</span><div>WIKIPEDIA<small>The Free Encyclopedia</small></div></div><h1>${data.parse.displaytitle}</h1><div class="wiki-subtitle">Z Wikipedie, otevřené encyklopedie</div><div class="wiki-body">${parsed.html}</div></div>`;
    content.querySelectorAll<HTMLAnchorElement>('.wiki-body a').forEach((anchor) => {
      const href = anchor.getAttribute('href');
      const match = href?.match(/(?:\.\/wiki\/|\/wiki\/)([^#?]+)/);
      if (!match || anchor.classList.contains('new')) { anchor.removeAttribute('href'); anchor.classList.add('non-game-link'); return; }
      const articleName = decodeURIComponent(match[1]).replaceAll('_', ' ');
      anchor.href = '#';
      anchor.dataset.article = articleName;
      anchor.addEventListener('click', (event) => { event.preventDefault(); void navigateToArticle(articleName); });
    });
    if (isClick && !route.some((item) => item.toLocaleLowerCase() === parsed.title.toLocaleLowerCase())) route.push(parsed.title);
    else if (!isClick && route.length === 1) route[0] = parsed.title;
    updateHud();
    if (parsed.title.toLocaleLowerCase() === targetTitle.toLocaleLowerCase()) showResult(true);
  } catch (error) {
    content.innerHTML = `<div class="article-error"><span>!</span><h2>Článek se nenačetl</h2><p>${escapeHtml(error instanceof Error ? error.message : 'Zkus to prosím znovu.')}</p><button id="retry-load">ZKUSIT ZNOVU ↻</button></div>`;
    content.querySelector('#retry-load')?.addEventListener('click', () => void loadArticle(title, isClick));
  } finally { loading = false; }
}

async function navigateToArticle(title: string) {
  clicks += 1;
  if (!route.some((item) => item.toLocaleLowerCase() === title.toLocaleLowerCase())) route.push(title);
  updateHud();
  await loadArticle(title, true);
}

function updateHud() {
  const clickCount = app.querySelector<HTMLElement>('#click-count');
  const articleCount = app.querySelector<HTMLElement>('#article-count');
  const routeList = app.querySelector<HTMLOListElement>('#route-list');
  if (clickCount) clickCount.textContent = clicks.toString().padStart(2, '0');
  if (articleCount) articleCount.textContent = route.length.toString().padStart(2, '0');
  if (routeList) routeList.innerHTML = route.map((title, index) => `<li><i class="route-dot ${index === 0 ? 'start-dot' : ''}"></i><span class="route-item">${escapeHtml(title)}</span>${index === 0 ? '<b>START</b>' : ''}</li>`).join('');
  const target = app.querySelector<HTMLElement>('#goal-title');
  if (target) target.textContent = targetTitle;
}

function showResult(won: boolean) {
  if (timerId) window.clearInterval(timerId);
  const elapsed = formatTime(Math.floor((Date.now() - startedAt) / 1000));
  const overlay = app.querySelector<HTMLDivElement>('#result-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.innerHTML = `<div class="result-card"><button id="close-result" class="result-close" aria-label="Zavřít">×</button><div class="result-symbol">${won ? '✳' : '↗'}</div><p class="eyebrow">${won ? 'CÍL DORUČEN' : 'KAŽDÁ CESTA NĚCO NAUČÍ'}</p><h2>${won ? 'To byla jízda.' : 'Závod ukončen.'}</h2><p class="result-copy">${won ? `Dostal/a ses z článku <b>${escapeHtml(startTitle)}</b> až na <b>${escapeHtml(targetTitle)}</b>.` : `Tvůj cíl byl článek <b>${escapeHtml(targetTitle)}</b>. Zkus trasu znovu a najdi jinou cestu.`}</p><div class="result-stats"><div><span>ČAS</span><strong>${elapsed}</strong></div><div><span>KLIKNUTÍ</span><strong>${clicks.toString().padStart(2, '0')}</strong></div></div><button class="start-button" id="result-new-game"><span>JEŠTĚ JEDEN ZÁVOD</span><b>→</b></button><button class="text-button" id="result-home">ZMĚNIT TRASU</button></div>`;
  overlay.querySelector('#close-result')!.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.querySelector('#result-new-game')!.addEventListener('click', () => { overlay.classList.add('hidden'); startedAt = Date.now(); clicks = 0; route = [startTitle]; renderGame(); void loadArticle(startTitle, false); });
  overlay.querySelector('#result-home')!.addEventListener('click', goHome);
}

function confirmExit() {
  if (clicks === 0 && !currentTitle) { goHome(); return; }
  const overlay = app.querySelector<HTMLDivElement>('#result-overlay')!;
  overlay.classList.remove('hidden');
  overlay.innerHTML = `<div class="result-card confirm-card"><button id="close-result" class="result-close" aria-label="Zavřít">×</button><div class="result-symbol">↗</div><p class="eyebrow">OPUSTIT ZÁVOD?</p><h2>Už teď končíš?</h2><p class="result-copy">Dosavadní čas a trasa se po opuštění smažou.</p><button class="start-button" id="confirm-home"><span>OPUSTIT HRU</span><b>→</b></button><button class="text-button" id="keep-playing">POKRAČOVAT VE HŘE</button></div>`;
  overlay.querySelector('#close-result')!.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.querySelector('#keep-playing')!.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.querySelector('#confirm-home')!.addEventListener('click', goHome);
}

function goHome() {
  if (timerId) window.clearInterval(timerId);
  currentTitle = '';
  clicks = 0;
  route = [];
  loading = false;
  renderSetup();
}

renderSetup();
