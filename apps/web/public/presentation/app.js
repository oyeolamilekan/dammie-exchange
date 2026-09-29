const slides = [...document.querySelectorAll('.slide')];
const previousButton = document.querySelector('#previous');
const nextButton = document.querySelector('#next');
const fullscreenButton = document.querySelector('#fullscreen');
const currentSlide = document.querySelector('#currentSlide');
const progress = document.querySelector('.progress');

const hashIndex = Number.parseInt(window.location.hash.replace('#', ''), 10) - 1;
let activeIndex = Number.isInteger(hashIndex) && hashIndex >= 0 && hashIndex < slides.length ? hashIndex : 0;

function showSlide(index, { updateHash = true } = {}) {
  activeIndex = Math.max(0, Math.min(index, slides.length - 1));

  slides.forEach((slide, slideIndex) => {
    const isActive = slideIndex === activeIndex;
    slide.classList.toggle('is-active', isActive);
    slide.classList.remove('is-entering');
    slide.setAttribute('aria-hidden', String(!isActive));
    if (isActive) requestAnimationFrame(() => slide.classList.add('is-entering'));
  });

  currentSlide.textContent = String(activeIndex + 1);
  progress.style.setProperty('--progress', `${((activeIndex + 1) / slides.length) * 100}%`);
  previousButton.disabled = activeIndex === 0;
  nextButton.disabled = activeIndex === slides.length - 1;
  document.title = `${String(activeIndex + 1).padStart(2, '0')} — ${slides[activeIndex].dataset.title} · Dammie AI`;
  if (updateHash) history.replaceState(null, '', `#${activeIndex + 1}`);
}

function previous() { showSlide(activeIndex - 1); }
function next() { showSlide(activeIndex + 1); }

previousButton.addEventListener('click', previous);
nextButton.addEventListener('click', next);

fullscreenButton.addEventListener('click', async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent = document.fullscreenElement ? '×' : '⛶';
  fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
});

document.addEventListener('keydown', (event) => {
  if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(event.key)) {
    event.preventDefault();
    next();
  }
  if (['ArrowLeft', 'PageUp', 'Backspace'].includes(event.key)) {
    event.preventDefault();
    previous();
  }
  if (event.key.toLowerCase() === 'f') fullscreenButton.click();
  if (event.key === 'Home') showSlide(0);
  if (event.key === 'End') showSlide(slides.length - 1);
});

let wheelLocked = false;
document.addEventListener('wheel', (event) => {
  if (wheelLocked || Math.abs(event.deltaY) < 20) return;
  wheelLocked = true;
  event.deltaY > 0 ? next() : previous();
  window.setTimeout(() => { wheelLocked = false; }, 520);
}, { passive: true });

window.addEventListener('hashchange', () => {
  const index = Number.parseInt(window.location.hash.replace('#', ''), 10) - 1;
  if (Number.isInteger(index)) showSlide(index, { updateHash: false });
});

showSlide(activeIndex);
