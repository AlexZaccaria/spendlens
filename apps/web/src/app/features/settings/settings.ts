import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { Tab, TabContent, TabList, TabPanel, Tabs } from '@angular/aria/tabs';
import { form, FormField } from '@angular/forms/signals';
import { Icon } from '../../ui/icon';
import {
  AI_PROVIDERS,
  ECB_CURRENCIES,
  EFFORTS,
  type AiModel,
  type AiProvider,
  type AiSettingsUpdate,
  type AiSettingsView,
  type AuthMode,
  type CredentialCandidate,
  type IgnoredRecurring,
  type Effort,
  type Rule,
} from '@spendlens/contracts';
import { API, Api, apiErrorCode, apiErrorMessage, DataRevision } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { Auth } from '../../core/auth';
import { AppState } from '../../core/period';
import { Toasts } from '../../core/toasts';
import { CategoryIcon } from '../../ui/category-icon';

interface AiForm {
  provider: AiProvider;
  authMode: AuthMode;
  apiKey: string;
  oauthCredentialPath: string;
  baseUrl: string;
  model: string;
  effort: Effort | '';
}

const EMPTY_FORM: AiForm = { provider: 'anthropic', authMode: 'key', apiKey: '', oauthCredentialPath: '', baseUrl: '', model: '', effort: 'medium' };

const ENV_NAMES: Record<AiProvider, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', 'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY' };

@Component({
  selector: 'app-settings',
  imports: [Tabs, TabList, Tab, TabPanel, TabContent, FormField, Icon, CategoryIcon],
  templateUrl: './settings.html',
})
export class Settings {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(AppState);
  protected readonly auth = inject(Auth);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly revision = inject(DataRevision);
  protected readonly t = this.i18n.t;
  protected readonly providers = AI_PROVIDERS;
  protected readonly envNames = ENV_NAMES;

  protected readonly tab = signal<string | undefined>('ai');

  protected readonly settings = httpResource<AiSettingsView>(() => ({ url: `${API}/ai/settings`, params: { rev: this.revision.value() } }));
  protected readonly rules = httpResource<Rule[]>(() => ({ url: `${API}/rules`, params: { rev: this.revision.value() } }));
  protected readonly excluded = httpResource<IgnoredRecurring[]>(() => ({ url: `${API}/recurring/ignored`, params: { rev: this.revision.value() } }));
  protected readonly view = computed(() => this.settings.value());

  private readonly fromServer = computed<AiForm | null>(() => {
    const v = this.view();
    return v ? { provider: v.provider, authMode: v.authMode, apiKey: '', oauthCredentialPath: v.oauthCredentialPath, baseUrl: v.baseUrl, model: v.model, effort: v.effort ?? '' } : null;
  });
  /** The form follows the saved settings; a key being typed survives the reload after another change. */
  protected readonly model = linkedSignal<AiForm | null, AiForm>({
    source: this.fromServer,
    computation: (server, previous) => ({ ...(server ?? EMPTY_FORM), apiKey: previous?.value.apiKey ?? '' }),
  });
  protected readonly aiForm = form(this.model);

  protected readonly candidates = signal<CredentialCandidate[]>([]);
  protected readonly showHidden = signal(false);
  private readonly inUsePath = computed(() => this.model().oauthCredentialPath);
  /** Usable files first; the file in use stays listed even after it was removed from the list. */
  protected readonly listedCandidates = computed(() =>
    this.candidates()
      .filter((c) => !c.hidden || c.path === this.inUsePath())
      .sort((a, b) => Number(this.isExpired(a)) - Number(this.isExpired(b))),
  );
  protected readonly hiddenCandidates = computed(() => this.candidates().filter((c) => c.hidden && c.path !== this.inUsePath()));

  protected readonly models = signal<AiModel[] | null>(null);
  protected readonly modelsState = signal<'idle' | 'loading' | 'error'>('idle');
  protected readonly selectedModel = computed(() => this.models()?.find((m) => m.id === this.model().model) ?? null);
  /** One model per line, the newest (all of them when the provider has no lines); the saved one stays listed. */
  protected readonly modelChoices = computed(() => {
    const all = this.models() ?? [];
    const latest = all.filter((m) => m.latest).sort((a, b) => a.label.localeCompare(b.label));
    const choices = latest.length ? latest : all;
    const current = this.selectedModel();
    return current && !choices.includes(current) ? [...choices, current] : choices;
  });
  /** Effort levels the chosen model accepts (all of them when the provider does not say). */
  protected readonly effortOptions = computed<readonly Effort[]>(() => this.selectedModel()?.efforts ?? EFFORTS);
  protected readonly busy = signal<'demo' | 'remove' | 'reset' | null>(null);

  protected readonly currencies = ECB_CURRENCIES;
  protected readonly changingCurrency = signal(false);
  private readonly currencyNames = computed(() => new Intl.DisplayNames([this.i18n.locale()], { type: 'currency' }));

  protected currencyName(code: string): string {
    return this.currencyNames().of(code) ?? code;
  }

  /** Not optimistic: the whole history is converted, which takes a moment and needs the rate service. */
  protected async setBaseCurrency(currency: string, select: HTMLSelectElement): Promise<void> {
    if (currency === this.state.baseCurrency()) return;
    this.changingCurrency.set(true);
    try {
      const result = await this.api.setBaseCurrency(currency);
      this.toasts.success(this.t().settings.currencyChanged(result.baseCurrency, result.converted));
      if (result.missing > 0) this.toasts.error(this.t().settings.currencyMissing(result.missing));
    } catch (err) {
      select.value = this.state.baseCurrency();
      this.toasts.error(this.errorText(err));
    } finally {
      this.changingCurrency.set(false);
    }
  }
  protected readonly confirmReset = signal(false);

  protected readonly provider = computed(() => this.model().provider);
  protected readonly oauth = computed(() => this.provider() === 'anthropic' && this.model().authMode === 'oauth');

  /** The saved, ready credential the model list belongs to: when it changes, the list is reloaded. */
  private readonly modelsSource = computed(() => {
    const v = this.view();
    return v?.ready ? [v.provider, v.authMode, v.apiKeySet, v.oauthCredentialPath, v.oauthCredentialImported, v.baseUrl].join('|') : null;
  });

  constructor() {
    effect(() => {
      if (this.oauth()) void this.loadCandidates();
    });
    effect(() => {
      if (this.modelsSource() !== null && untracked(() => this.provider() === this.view()?.provider)) void this.loadModels();
    });
  }

  // Every change is saved at once and shown before the server answers (optimistic). Saves run in
  // order; a refusal is reported and the form goes back to the saved values.
  private saves: Promise<unknown> = Promise.resolve();

  private persist(write: () => Promise<unknown>): void {
    this.saves = this.saves.then(async () => {
      try {
        await write();
      } catch (err) {
        this.toasts.error(this.errorText(err));
        const saved = this.fromServer();
        if (saved) this.model.set(saved);
      }
    });
  }

  private patch(change: Partial<AiForm>, patch: AiSettingsUpdate): void {
    this.model.update((m) => ({ ...m, ...change }));
    this.persist(() => this.api.saveAiSettings(patch));
  }

  protected setProvider(provider: AiProvider): void {
    if (provider === this.provider()) return;
    // The server answers with this provider's own key and model; the list follows the new credential.
    this.models.set(null);
    this.modelsState.set('idle');
    this.patch({ provider }, { provider });
  }

  protected setAuth(authMode: AuthMode): void {
    if (authMode !== this.model().authMode) this.patch({ authMode }, { authMode });
  }

  protected setModel(id: string): void {
    const efforts = this.models()?.find((m) => m.id === id)?.efforts;
    // A level the new model does not accept would be a 400 on every call.
    const effort = efforts ? fitEffort(this.model().effort, efforts) : this.model().effort;
    this.patch({ model: id, effort }, { model: id, effort: effort === '' ? null : effort });
  }

  protected setEffort(effort: Effort | ''): void {
    this.patch({ effort }, { effort: effort === '' ? null : effort });
  }

  /** Text fields are saved when they lose focus or on Enter, if they changed. */
  protected commit(field: 'baseUrl' | 'oauthCredentialPath' | 'model'): void {
    const value = this.model()[field].trim();
    if (value !== this.fromServer()?.[field]) this.patch({ [field]: value }, { [field]: value });
  }

  /** The key is write-only: once sent, the field empties and shows that a key is stored. */
  protected commitKey(): void {
    const apiKey = this.model().apiKey.trim();
    if (apiKey) this.patch({ apiKey: '' }, { apiKey });
  }

  protected async loadCandidates(): Promise<void> {
    try {
      this.candidates.set(await this.api.credentialCandidates());
    } catch {
      this.candidates.set([]);
    }
  }

  protected async loadModels(refresh = false): Promise<void> {
    this.modelsState.set('loading');
    try {
      this.models.set(await this.api.models(refresh));
      this.modelsState.set('idle');
    } catch {
      this.models.set(null);
      this.modelsState.set('error');
    }
  }

  /** The refresh button: waits for pending saves, then asks the provider again. */
  protected async refreshModels(): Promise<void> {
    await this.saves;
    await this.loadModels(true);
  }

  protected async setHidden(candidate: CredentialCandidate, hidden: boolean): Promise<void> {
    const before = this.candidates();
    this.candidates.set(before.map((c) => (c.path === candidate.path ? { ...c, hidden } : c)));
    try {
      await this.api.setCredentialHidden(candidate.path, hidden);
    } catch (err) {
      this.candidates.set(before);
      this.toasts.error(this.errorText(err));
    }
  }

  protected useCandidate(path: string): void {
    const change = { provider: 'anthropic', authMode: 'oauth', oauthCredentialPath: path } as const;
    this.patch(change, change);
  }

  protected async uploadCredentials(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const json: unknown = JSON.parse(await file.text());
      await this.api.importCredentials(json);
      this.toasts.success(this.t().settings.saved);
    } catch (err) {
      this.toasts.error(this.errorText(err));
    }
  }

  protected disconnect(): void {
    this.model.update((m) => ({ ...m, oauthCredentialPath: '' }));
    this.persist(() => this.api.removeCredentials());
  }

  protected removeKey(): void {
    this.persist(() => this.api.saveAiSettings({ apiKey: null }));
  }

  protected async deleteRule(rule: Rule): Promise<void> {
    const before = this.rules.value();
    this.rules.set(before?.filter((r) => r.id !== rule.id));
    try {
      await this.api.deleteRule(rule.id);
    } catch (err) {
      this.rules.set(before);
      this.toasts.error(this.errorText(err));
    }
  }

  /** Puts an excluded merchant back among the fixed costs (optimistic). */
  protected async restoreExcluded(rule: IgnoredRecurring): Promise<void> {
    const before = this.excluded.value();
    this.excluded.set(before?.filter((r) => r.id !== rule.id));
    try {
      await this.api.deleteRecurring(rule.id);
    } catch (err) {
      this.excluded.set(before);
      this.toasts.error(this.errorText(err));
    }
  }

  protected async demo(action: 'demo' | 'remove' | 'reset'): Promise<void> {
    this.busy.set(action);
    try {
      if (action === 'demo') this.toasts.success(this.t().settings.demoLoaded((await this.api.seedDemo()).inserted));
      else if (action === 'remove') await this.api.removeDemo();
      else {
        await this.api.resetData();
        this.confirmReset.set(false);
      }
    } catch (err) {
      this.toasts.error(this.errorText(err));
    } finally {
      this.busy.set(null);
    }
  }

  /** Known errors in the page language, otherwise the server's own message. */
  private errorText(err: unknown): string {
    return this.t().settings.errors[apiErrorCode(err) ?? ''] ?? apiErrorMessage(err);
  }

  protected isExpired(candidate: CredentialCandidate): boolean {
    return candidate.expiresAt !== null && Date.parse(candidate.expiresAt) < Date.now();
  }

  protected expiry(candidate: CredentialCandidate): string {
    if (!candidate.expiresAt) return '';
    return this.isExpired(candidate) ? this.t().settings.expired : this.t().settings.expires(this.i18n.date(candidate.expiresAt, 'medium'));
  }
}

/** Keeps the chosen effort when the new model accepts it, else falls back to medium (or the closest it has). */
function fitEffort(current: Effort | '', supported: readonly Effort[]): Effort | '' {
  if (supported.length === 0) return '';
  if (current === '' || supported.includes(current)) return current;
  return supported.includes('medium') ? 'medium' : supported[0]!;
}
