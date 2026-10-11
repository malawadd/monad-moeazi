import {renderAudit} from './audit.js';
import {renderResearch} from './research.js';

renderAudit();
renderResearch();

document.querySelectorAll('.rail nav a').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.rail nav a').forEach(item => item.removeAttribute('aria-current'));
    link.setAttribute('aria-current', 'location');
  });
});
