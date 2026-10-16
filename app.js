const $ = (s) => document.querySelector(s);
const state = { genre: '', movies: [], saved: readStore('cineclub-saved'), passed: readStore('cineclub-passed'), view: 'discover', loading: false };
function readStore(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function writeStore() { localStorage.setItem('cineclub-saved', JSON.stringify(state.saved)); localStorage.setItem('cineclub-passed', JSON.stringify(state.passed)); updateCounts(); }
function updateCounts() { $('#savedCount').textContent = state.saved.length; $('#passedCount').textContent = state.passed.length; }
function escapeHtml(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function poster(path) { return path && path !== 'N/A' ? path : 'https://placehold.co/600x450/24251f/d5fa62?text=No+poster'; }
function year(date) { return date ? date.slice(0,4) : 'Год неизвестен'; }
function prettyGenres(movie) {
  const ids = movie.genre_ids || [];
  const names = ids.map(id => (window.genreNames || {})[id] || id).filter(Boolean);
  return names.slice(0,2).join(' · ') || 'Фильм';
}
async function api(path) {
  const res = await fetch(path);
  let body = {};
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(body.detail || `Ошибка сервера (${res.status})`);
  return body;
}
function showError(message) { $('#errorBox').textContent = message; $('#errorBox').classList.remove('hidden'); }
function clearError() { $('#errorBox').classList.add('hidden'); $('#errorBox').textContent = ''; }
function setLoading(on) { state.loading = on; $('#loading').classList.toggle('hidden', !on); if(on) $('#movieGrid').innerHTML=''; $('#refreshBtn').disabled = on; $('#refreshBtn').style.opacity = on ? '.6' : '1'; }
async function init() {
  updateCounts();
  try {
    const status = await api('/api/status');
    if (!status.configured) { $('#apiStatus').textContent = 'нужен API-ключ'; showError('Почти готово! Добавь свой OMDb API key в файл .env. Инструкция находится в START_HERE.txt.'); setLoading(false); return; }
    $('#apiStatus').textContent = 'OMDb подключён';
    const genres = await api('/api/genres');
    window.genreNames = {};
    genres.forEach(g => { window.genreNames[g.id] = g.name; const opt = document.createElement('option'); opt.value = g.id; opt.textContent = g.name; $('#genreSelect').appendChild(opt); });
    await loadPicks();
  } catch (e) { showError(`${e.message}. Проверь подключение и API-ключ в .env, затем обнови страницу.`); $('#apiStatus').textContent = 'ошибка подключения'; setLoading(false); }
}
async function loadPicks() {
  clearError(); setLoading(true);
  try {
    const excludeIds = [...state.saved, ...state.passed].map(m => m.id);
    const data = await api(`/api/picks?genre_id=${encodeURIComponent(state.genre)}&exclude=${encodeURIComponent(excludeIds.join(','))}`);
    state.movies = data.results || [];
    if (!state.movies.length) { $('#movieGrid').innerHTML = ''; showError('Пока не нашлось подходящих фильмов. Выбери другой жанр или нажми «Другая подборка».'); }
    renderMovies();
    $('#resultNote').textContent = `ПОДБОРКА ИЗ ${state.movies.length} ФИЛЬМОВ`;
  } catch (e) { showError(e.message); }
  finally { setLoading(false); }
}
function movieCard(movie, index) {
  const title = movie.title || movie.original_title || 'Без названия';
  const overview = movie.overview || 'Описание для этого фильма пока не добавлено.';
  const rating = Number(movie.vote_average || 0).toFixed(1);
  return `<article class="movie-card" data-id="${movie.id}">
    <div class="poster-wrap"><img src="${poster(movie.poster_path)}" alt="Постер фильма «${escapeHtml(title)}»" loading="lazy" onerror="this.src='https://placehold.co/600x450/24251f/d5fa62?text=No+poster'"><div class="poster-gradient"></div><div class="poster-topline"><span class="tag">ВАРИАНТ 0${index+1}</span><span class="rating"><span>★</span>${rating}</span></div><div class="poster-bottom"><span>${escapeHtml(year(movie.release_date))}</span><span>IMDb ↗</span></div></div>
    <div class="movie-info"><h2 class="movie-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h2><div class="movie-meta"><span>${escapeHtml(prettyGenres(movie))}</span><span class="meta-sep">/</span><span>${escapeHtml(movie.original_language || '—').toUpperCase()}</span></div><p class="movie-overview">${escapeHtml(overview)}</p><div class="card-actions"><button class="action-btn yes" data-action="yes" data-id="${movie.id}"><span class="action-icon">♡</span> ДА, В СПИСОК</button><button class="action-btn no" data-action="no" data-id="${movie.id}"><span class="action-icon">×</span> НЕТ, ДАЛЬШЕ</button></div><a class="detail-link" href="https://www.imdb.com/title/${movie.id}/" target="_blank" rel="noopener">ПОДРОБНЕЕ О ФИЛЬМЕ ↗</a></div>
  </article>`;
}
function renderMovies() { $('#movieGrid').innerHTML = state.movies.map(movieCard).join(''); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }
function actOnMovie(id, action) {
  const movie = state.movies.find(m => String(m.id) === String(id)); if (!movie) return;
  if (action === 'yes') {
    if (!state.saved.some(m => m.id === movie.id)) state.saved.unshift(movie);
    state.passed = state.passed.filter(m => String(m.id) !== String(movie.id));
    toast('Добавили в избранное ♡');
  } else {
    if (!state.passed.some(m => m.id === movie.id)) state.passed.unshift(movie);
    state.saved = state.saved.filter(m => String(m.id) !== String(movie.id));
    toast('Окей, ищем дальше ↗');
  }
  writeStore();
  state.movies = state.movies.filter(m => String(m.id) !== String(movie.id));
  renderMovies();
  $('#resultNote').textContent = `ОСТАЛОСЬ ${state.movies.length} ФИЛЬМА(ОВ)`;
  if (!state.movies.length) { $('#movieGrid').innerHTML = ''; $('#loading').classList.remove('hidden'); loadPicks(); }
}
function switchView(view) {
  state.view = view;
  $('#discoverView').classList.toggle('hidden', view !== 'discover');
  $('#collectionView').classList.toggle('hidden', view === 'discover');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#breadcrumbCurrent').textContent = view === 'discover' ? 'ПОДБОРКА' : view === 'saved' ? 'ИЗБРАННОЕ' : 'ПРОПУЩЕНО';
  if (view !== 'discover') renderCollection(view);
  window.scrollTo({top:0,behavior:'smooth'});
}
function renderCollection(view) {
  const items = view === 'saved' ? state.saved : state.passed;
  $('#collectionTitle').innerHTML = view === 'saved' ? 'Избранное<span class="lime-dot">.</span>' : 'Пропущенные<span class="lime-dot">.</span>';
  $('#collectionCopy').textContent = view === 'saved' ? 'Фильмы, которые хочется посмотреть.' : 'Фильмы, которые ты пока решил(а) пропустить.';
  $('#emptyCollection').classList.toggle('hidden', items.length > 0);
  $('#collectionGrid').classList.toggle('hidden', items.length === 0);
  $('#collectionGrid').innerHTML = items.map(m => `<article class="collection-card"><img src="${poster(m.poster_path)}" alt="Постер ${escapeHtml(m.title || m.original_title || '')}" loading="lazy"><div class="collection-card-info"><h3>${escapeHtml(m.title || m.original_title || 'Без названия')}</h3><p>${escapeHtml(year(m.release_date))} · ★ ${Number(m.vote_average || 0).toFixed(1)}</p><div class="collection-actions"><a href="https://www.imdb.com/title/${m.id}/" target="_blank" rel="noopener">О фильме ↗</a><button data-collection-action="remove" data-id="${m.id}" data-view="${view}">Убрать ×</button></div></div></article>`).join('');
}
$('#movieGrid').addEventListener('click', e => { const btn = e.target.closest('button[data-action]'); if (btn) actOnMovie(btn.dataset.id, btn.dataset.action); });
$('#collectionGrid').addEventListener('click', e => { const btn = e.target.closest('button[data-collection-action]'); if (!btn) return; const key = btn.dataset.view === 'saved' ? 'saved' : 'passed'; state[key] = state[key].filter(m => String(m.id) !== String(btn.dataset.id)); writeStore(); renderCollection(state.view); toast('Убрано из списка'); });
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
$('#refreshBtn').addEventListener('click', loadPicks);
$('#genreSelect').addEventListener('change', e => { state.genre = e.target.value; loadPicks(); });
$('#backToDiscover').addEventListener('click', () => switchView('discover'));
init();
