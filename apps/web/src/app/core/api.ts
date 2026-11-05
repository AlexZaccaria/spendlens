import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Service, signal } from '@angular/core';
import type {
  AiModel,
  AiSettingsUpdate,
  AiSettingsView,
  ApiError,
  BaseCurrencyResult,
  BulkUpdate,
  CredentialCandidate,
  IgnoredRecurring,
  ImportRecord,
  Insight,
  MonthKey,
  RecurringInput,
  RecurringItem,
  Transaction,
  TransactionCreate,
  TransactionPatch,
} from '@spendlens/contracts';
import { firstValueFrom } from 'rxjs';

export const API = '/api';

/** The message of an API error body, or a generic one. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as Partial<ApiError> | null;
    return body?.error?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function apiErrorCode(err: unknown): string | null {
  if (err instanceof HttpErrorResponse) return (err.error as Partial<ApiError> | null)?.error?.code ?? null;
  return null;
}

/**
 * Data revision: every mutation bumps it, and every read resource includes it in its request,
 * so the dashboard, the lists and the counters refresh together after an edit or an import.
 */
@Service()
export class DataRevision {
  readonly value = signal(0);
  bump(): void {
    this.value.update((v) => v + 1);
  }
}

/** Mutations and one-off calls. Reads go through `httpResource` in the components. */
@Service()
export class Api {
  private readonly http = inject(HttpClient);
  private readonly revision = inject(DataRevision);

  private async mutate<T>(request: Promise<T>): Promise<T> {
    const result = await request;
    this.revision.bump();
    return result;
  }

  createTransaction(body: TransactionCreate): Promise<Transaction> {
    return this.mutate(firstValueFrom(this.http.post<Transaction>(`${API}/transactions`, body)));
  }

  updateTransaction(id: string, patch: TransactionPatch): Promise<Transaction> {
    return this.mutate(firstValueFrom(this.http.patch<Transaction>(`${API}/transactions/${id}`, patch)));
  }

  updateItem(transactionId: string, itemId: string, categoryId: string): Promise<Transaction> {
    return this.mutate(firstValueFrom(this.http.patch<Transaction>(`${API}/transactions/${transactionId}/items/${itemId}`, { categoryId })));
  }

  bulkUpdate(body: BulkUpdate): Promise<{ updated: number }> {
    return this.mutate(firstValueFrom(this.http.post<{ updated: number }>(`${API}/transactions/bulk`, body)));
  }

  deleteTransaction(id: string): Promise<unknown> {
    return this.mutate(firstValueFrom(this.http.delete(`${API}/transactions/${id}`)));
  }

  deleteImport(id: string): Promise<unknown> {
    return this.mutate(firstValueFrom(this.http.delete(`${API}/imports/${id}`)));
  }

  deleteRule(id: string): Promise<unknown> {
    return this.mutate(firstValueFrom(this.http.delete(`${API}/rules/${id}`)));
  }

  /** Declares a fixed cost, or rewrites the declaration `id`. */
  saveRecurring(input: RecurringInput, id?: string): Promise<RecurringItem[]> {
    const request = id
      ? this.http.put<RecurringItem[]>(`${API}/recurring/${encodeURIComponent(id)}`, input)
      : this.http.post<RecurringItem[]>(`${API}/recurring`, input);
    return this.mutate(firstValueFrom(request));
  }

  /** "Not a fixed cost": the merchant leaves the fixed costs until restored. */
  ignoreRecurring(merchant: string): Promise<RecurringItem[]> {
    return this.mutate(firstValueFrom(this.http.post<RecurringItem[]>(`${API}/recurring/ignore`, { merchant })));
  }

  /** Removes a declaration or an exclusion. */
  deleteRecurring(id: string): Promise<RecurringItem[]> {
    return this.mutate(firstValueFrom(this.http.delete<RecurringItem[]>(`${API}/recurring/${encodeURIComponent(id)}`)));
  }

  ignoredRecurring(): Promise<IgnoredRecurring[]> {
    return firstValueFrom(this.http.get<IgnoredRecurring[]>(`${API}/recurring/ignored`));
  }

  /** Converts the whole history to `currency`; every total follows. */
  setBaseCurrency(currency: string): Promise<BaseCurrencyResult> {
    return this.mutate(firstValueFrom(this.http.put<BaseCurrencyResult>(`${API}/settings/currency`, { currency })));
  }

  generateInsight(month: MonthKey): Promise<Insight> {
    return this.mutate(firstValueFrom(this.http.post<Insight>(`${API}/insights/${month}`, {})));
  }

  seedDemo(): Promise<{ inserted: number }> {
    return this.mutate(firstValueFrom(this.http.post<{ inserted: number }>(`${API}/demo/seed`, {})));
  }

  removeDemo(): Promise<{ deleted: number }> {
    return this.mutate(firstValueFrom(this.http.delete<{ deleted: number }>(`${API}/demo`)));
  }

  resetData(): Promise<unknown> {
    return this.mutate(firstValueFrom(this.http.post(`${API}/demo/reset`, {})));
  }

  saveAiSettings(patch: AiSettingsUpdate): Promise<AiSettingsView> {
    return this.mutate(firstValueFrom(this.http.put<AiSettingsView>(`${API}/ai/settings`, patch)));
  }

  importCredentials(json: unknown): Promise<AiSettingsView> {
    return this.mutate(firstValueFrom(this.http.post<AiSettingsView>(`${API}/ai/credentials`, json)));
  }

  removeCredentials(): Promise<AiSettingsView> {
    return this.mutate(firstValueFrom(this.http.delete<AiSettingsView>(`${API}/ai/credentials`)));
  }

  credentialCandidates(): Promise<CredentialCandidate[]> {
    return firstValueFrom(this.http.get<CredentialCandidate[]>(`${API}/ai/credentials/candidates`));
  }

  /** Removes a found credentials file from the settings list, or puts it back. */
  setCredentialHidden(path: string, hidden: boolean): Promise<CredentialCandidate[]> {
    return firstValueFrom(this.http.patch<CredentialCandidate[]>(`${API}/ai/credentials/candidates`, { path, hidden }));
  }

  /** The server keeps the list for a few minutes; `refresh` asks the provider again. */
  models(refresh = false): Promise<AiModel[]> {
    return firstValueFrom(this.http.get<AiModel[]>(`${API}/ai/models`, { params: refresh ? { refresh: true } : {} }));
  }

  imports(): Promise<ImportRecord[]> {
    return firstValueFrom(this.http.get<ImportRecord[]>(`${API}/imports`));
  }
}
