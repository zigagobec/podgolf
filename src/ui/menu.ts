import { PLAYER_CSS, PLAYER_NAMES } from '../materials';

/** Title screen with ready-up for both players, plus the pause overlay. */
export class Menu {
  readonly root: HTMLDivElement;
  private cards: HTMLDivElement[] = [];
  private botBtn: HTMLButtonElement;
  private pause: HTMLDivElement;
  ready = [false, false];
  bot = false;

  constructor(private onToggleBot: (bot: boolean) => void) {
    const root = (this.root = document.createElement('div'));
    root.className = 'menu';
    root.innerHTML = `
      <div class="card">
        <h1>PODGOLF</h1>
        <p class="sub">Dve podgani. Dve žogici. En odtok.</p>
        <div class="players"></div>
        <button class="bot" type="button"></button>
        <ul class="rules">
          <li><b>Drži</b> gumb za udarec in ga <b>spusti</b>, ko je moč prava – merilec niha gor in dol.</li>
          <li>Podgana se zaleti in z <b>gobcem</b> odbije žogico. Med polnjenjem se lahko obračaš in natančno meriš.</li>
          <li>Prva podgana, ki svojo žogico spravi <b>v odtok</b>, zmaga.</li>
          <li>Z zaletom lahko <b>podreš nasprotnika</b> ali mu izbiješ žogico. Pazi na kuhalnico!</li>
        </ul>
        <p class="hint">Igra se začne, ko sta pripravljena oba. <span class="k">M</span> zvok <span class="k">N</span> glasba <span class="k">Esc</span> pavza</p>
      </div>`;
    document.body.appendChild(root);
    const players = root.querySelector('.players') as HTMLDivElement;
    const keys = [
      ['W', 'A', 'S', 'D', 'SPACE'],
      ['↑', '←', '↓', '→', 'ENTER'],
    ];
    for (let i = 0; i < 2; i++) {
      const c = document.createElement('div');
      c.className = 'pcard';
      c.style.setProperty('--pc', PLAYER_CSS[i]);
      const k = keys[i];
      c.innerHTML = `
        <div class="name">${PLAYER_NAMES[i]}</div>
        <div class="keys"><span class="k">${k[0]}</span><span class="k">${k[1]}</span><span class="k">${k[2]}</span><span class="k">${k[3]}</span> hoja</div>
        <div class="keys"><span class="k wide">${k[4]}</span> drži &amp; spusti</div>
        <div class="state">pritisni <b>${k[4]}</b></div>`;
      c.addEventListener('click', () => this.setReady(i, !this.ready[i]));
      players.appendChild(c);
      this.cards.push(c);
    }
    this.botBtn = root.querySelector('.bot') as HTMLButtonElement;
    this.botBtn.addEventListener('click', () => this.toggleBot());
    this.renderBot();

    this.pause = document.createElement('div');
    this.pause.className = 'menu pause off';
    this.pause.innerHTML = `<div class="card small"><h2>Pavza</h2><p><span class="k">Esc</span> nadaljuj <span class="k">R</span> nova igra <span class="k">Q</span> začetni zaslon</p></div>`;
    document.body.appendChild(this.pause);
  }

  toggleBot(): void {
    this.bot = !this.bot;
    if (this.bot) this.setReady(1, true);
    else this.setReady(1, false);
    this.renderBot();
    this.onToggleBot(this.bot);
  }

  private renderBot(): void {
    this.botBtn.innerHTML = this.bot ? '🤖 Mrvico vodi računalnik <small>(tipka B: dva igralca)</small>' : '👥 Dva igralca <small>(tipka B: igraj proti računalniku)</small>';
    this.cards[1].classList.toggle('cpu', this.bot);
  }

  setReady(i: number, r: boolean): void {
    if (i === 1 && this.bot) r = true;
    this.ready[i] = r;
    const c = this.cards[i];
    c.classList.toggle('ready', r);
    (c.querySelector('.state') as HTMLDivElement).innerHTML = r ? (i === 1 && this.bot ? 'računalnik je pripravljen ✓' : 'pripravljen ✓') : `pritisni <b>${i === 0 ? 'SPACE' : 'ENTER'}</b>`;
  }

  show(on: boolean): void {
    this.root.classList.toggle('off', !on);
    if (on) {
      this.setReady(0, false);
      this.setReady(1, this.bot);
    }
  }

  showPause(on: boolean): void {
    this.pause.classList.toggle('off', !on);
  }
}
