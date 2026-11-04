import { Component, input } from '@angular/core';

/** HospitOS brand mark ("Together H"): two people whose joined hands form the crossbar of an H. */
@Component({
  selector: 'app-logo',
  standalone: true,
  host: { class: 'app-logo', '[class.reverse]': 'reverse()' },
  template: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="21" y="33" width="22" height="9" rx="4.5" class="hands"/>
      <circle cx="19.5" cy="12.5" r="6.5" class="a"/><rect x="13" y="23" width="13" height="34" rx="6.5" class="a"/>
      <circle cx="44.5" cy="12.5" r="6.5" class="b"/><rect x="38" y="23" width="13" height="34" rx="6.5" class="b"/>
      <rect x="24" y="33" width="16" height="9" class="hands"/>
    </svg>
    @if (wordmark()) { <span class="wm">Hospit<b>OS</b></span> }`,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 10px; font-weight: 800; letter-spacing: -0.01em; }
    svg { width: 1.6em; height: 1.6em; flex: none; }
    .a { fill: var(--pri); } .b { fill: var(--blue); } .hands { fill: var(--amber); }
    .wm b { color: var(--pri); font-weight: 800; }
    :host(.reverse) .a, :host(.reverse) .b { fill: #fff; }
    :host(.reverse) .wm b { color: #bfe6dc; }
  `],
})
export class LogoComponent {
  wordmark = input(true);
  reverse = input(false);
}
