// ===== Anime Finder 
// API: Kitsu (free, no API key) - https://kitsu.docs.apiary.io/

const API_URL = 'https://kitsu.io/api/edge';
const LIMIT = 12;

// ----- DOM elements -----
const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const typeSelect = document.getElementById('type-select');
const heading = document.getElementById('heading');
const spinner = document.getElementById('spinner');
const message = document.getElementById('message');
const results = document.getElementById('results');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modal = new bootstrap.Modal(document.getElementById('detail-modal'));

// Current results, saved by id. The modal reads from here.
const animeById = new Map();
let currentModalId = null;

// ----- Helpers -----

// Stop HTML injection: API text becomes safe text.
function escapeHTML(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

// GET request with a 10 second limit. Returns parsed JSON or throws an error.
async function getJSON(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${API_URL}${path}`, { signal: controller.signal });

    if (response.status === 429) {
      throw new Error('Too many requests. Wait 2 seconds and try again.');
    }
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Server is too slow. Try again later.');
    }
    if (error instanceof TypeError) {
      throw new Error('Network error. Check your internet or turn off VPN.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Minutes -> "84 h 20 min"
function formatMinutes(total) {
  if (!total) return 'Unknown';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// Kitsu item -> simple object. We use this everywhere.
function normalize(item) {
  const a = item.attributes;

  // averageRating is a text from 0 to 100, for example "82.19"
  const score = a.averageRating ? (Number(a.averageRating) / 10).toFixed(1) : 'N/A';

  // totalLength = all minutes. If it is missing, we calculate it.
  const totalMinutes = a.totalLength || (a.episodeCount && a.episodeLength
    ? a.episodeCount * a.episodeLength
    : null);

  return {
    id: item.id,
    title: a.canonicalTitle,
    poster: a.posterImage?.small ?? '',
    posterLarge: a.posterImage?.medium ?? a.posterImage?.small ?? '',
    score: score,
    type: a.subtype ?? '?',
    episodes: a.episodeCount,
    status: a.status ?? 'N/A',
    year: a.startDate ? a.startDate.slice(0, 4) : 'N/A',
    synopsis: a.synopsis ?? 'No description.',
    watchTime: formatMinutes(totalMinutes),
    adult: a.nsfw === true || a.ageRating === 'R18'
  };
}

function showMessage(text, type = 'danger') {
  message.className = `alert alert-${type}`;
  message.textContent = text;
}

function hideMessage() {
  message.className = 'alert d-none';
}

// ----- Main: load and show anime -----

async function loadAnime(path, title) {
  results.innerHTML = '';
  heading.textContent = title;
  hideMessage();
  spinner.classList.remove('d-none');

  try {
    const json = await getJSON(path);
    // Hide adult titles, then convert to simple objects
    const list = json.data.map(normalize).filter((anime) => !anime.adult);
    showCards(list);
  } catch (error) {
    showMessage(error.message);
  } finally {
    spinner.classList.add('d-none');
  }
}

function showCards(list) {
  if (list.length === 0) {
    showMessage('No anime found. Try another word.', 'warning');
    return;
  }

  animeById.clear();

  results.innerHTML = list.map((anime) => {
    animeById.set(anime.id, anime);

    return `
      <div class="col">
        <div class="card anime-card h-100">
          <img src="${escapeHTML(anime.poster)}" class="card-img-top" alt="${escapeHTML(anime.title)}" loading="lazy">
          <div class="card-body d-flex flex-column">
            <h3 class="card-title">${escapeHTML(anime.title)}</h3>
            <div class="mb-2">
              <span class="badge text-bg-warning">★ ${anime.score}</span>
              <span class="badge text-bg-secondary">${escapeHTML(anime.type)}</span>
              <span class="badge text-bg-info">${anime.episodes ?? '?'} ep</span>
            </div>
            <button class="btn btn-outline-primary btn-sm mt-auto" data-id="${escapeHTML(anime.id)}">Details</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ----- Modal with details + second AJAX request (genres) -----

function openDetails(id) {
  const anime = animeById.get(id);
  if (!anime) return;

  currentModalId = id;
  modalTitle.textContent = anime.title;

  modalBody.innerHTML = `
    <div class="row g-3">
      <div class="col-12 col-md-4">
        <img src="${escapeHTML(anime.posterLarge)}" class="modal-poster" alt="${escapeHTML(anime.title)}">
      </div>
      <div class="col-12 col-md-8">
        <ul class="list-unstyled">
          <li><strong>Score:</strong> ${anime.score} / 10</li>
          <li><strong>Type:</strong> ${escapeHTML(anime.type)}</li>
          <li><strong>Status:</strong> ${escapeHTML(anime.status)}</li>
          <li><strong>Year:</strong> ${escapeHTML(anime.year)}</li>
          <li><strong>Episodes:</strong> ${anime.episodes ?? 'Unknown'}</li>
          <li><strong>Time to watch all:</strong> <span class="text-warning">${anime.watchTime}</span></li>
          <li><strong>Genres:</strong> <span id="genres">Loading...</span></li>
        </ul>
        <p>${escapeHTML(anime.synopsis)}</p>
      </div>
    </div>`;

  modal.show();
  loadGenres(id);
}

async function loadGenres(id) {
  try {
    const json = await getJSON(`/anime/${id}/categories?page%5Blimit%5D=8`);

    // User opened another anime while we waited: stop.
    if (id !== currentModalId) return;

    const names = json.data.map((item) => item.attributes.title);
    document.getElementById('genres').textContent = names.length ? names.join(', ') : 'N/A';
  } catch (error) {
    if (id === currentModalId) {
      document.getElementById('genres').textContent = 'Could not load';
    }
  }
}

// ----- Events -----

form.addEventListener('submit', (event) => {
  event.preventDefault();                    // stop page reload
  const query = input.value.trim();
  if (query === '') return;

  let path = `/anime?filter%5Btext%5D=${encodeURIComponent(query)}&page%5Blimit%5D=${LIMIT}`;
  if (typeSelect.value) {
    path += `&filter%5Bsubtype%5D=${typeSelect.value}`;
  }
  loadAnime(path, `Results for "${query}"`);
});

// One listener for all "Details" buttons (event delegation)
results.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (button) {
    openDetails(button.dataset.id);          // Kitsu ids are text, so no Number()
  }
});

// First load: most popular anime
loadAnime(`/anime?sort=popularityRank&page%5Blimit%5D=${LIMIT}`, '🔥 Popular anime');