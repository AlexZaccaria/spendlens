import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n/i18n';
import { AppState } from '../core/period';
import { Icon } from '../ui/icon';
import { Logo } from '../ui/logo';
import { Preferences } from '../ui/preferences';

interface NavItem {
  readonly path: string;
  readonly icon: string;
  readonly label: (t: ReturnType<I18n['t']>) => string;
}

const NAV: readonly NavItem[] = [
  { path: '/', icon: 'layout-dashboard', label: (t) => t.nav.dashboard },
  { path: '/transactions', icon: 'list', label: (t) => t.nav.transactions },
  { path: '/import', icon: 'file-up', label: (t) => t.nav.import },
  { path: '/settings', icon: 'settings', label: (t) => t.nav.settings },
];

/** The story of the project: for demo visitors only. */
const ABOUT: NavItem = { path: '/about', icon: 'info', label: (t) => t.nav.about };

/** The signed-in app: sidebar (bottom bar on phones), account, AI status, preferences. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo, Preferences],
  templateUrl: './shell.html',
})
export class Shell {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  protected readonly state = inject(AppState);
  protected readonly t = this.i18n.t;
  protected readonly nav = computed(() => (this.auth.isDemo() ? [...NAV, ABOUT] : NAV));

  /**
   * The model by name and whether it answers: green once the provider accepted the saved
   * credential, red when it refused it, amber while something is still to fill in.
   */
  protected readonly ai = computed(() => {
    const t = this.t();
    const ai = this.state.meta.value()?.ai;
    const health = this.state.aiHealth.value();
    if (this.auth.isDemo() || health?.status === 'disabled') {
      return { name: t.ai.disabled, status: t.ai.inDemo, title: t.auth.demoAiOff, dot: 'var(--muted)', checking: false };
    }
    if (!ai?.ready || health?.status === 'missing') {
      return { name: t.ai.notReady, status: ai ? t.settings.providers[ai.provider]!.name : '', title: t.ai.configure, dot: 'var(--status-warning)', checking: false };
    }
    const name = modelName(ai.model);
    if (health?.status === 'error') return { name, status: t.ai.unreachable, title: health.message ?? '', dot: 'var(--status-critical)', checking: false };
    if (health?.status === 'ok') return { name, status: t.ai.online, title: t.ai.ready(ai.model), dot: 'var(--status-good)', checking: false };
    return { name, status: t.ai.checking, title: ai.model, dot: 'var(--muted)', checking: true };
  });
}

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5"; other ids are shown as they are. */
function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (!m) return id;
  const line = m[1]!;
  return `${line.charAt(0).toUpperCase()}${line.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}
