import { Service, signal } from '@angular/core';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: 'info' | 'success' | 'error';
  readonly action?: { readonly label: string; readonly run: () => void };
}

/** Transient notifications, announced through an aria-live region (see ToastHost). */
@Service()
export class Toasts {
  private nextId = 1;
  readonly items = signal<readonly Toast[]>([]);

  show(message: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ms = 5000): void {
    const toast: Toast = { id: this.nextId++, message, tone, ...(action && { action }) };
    this.items.update((list) => [...list.slice(-3), toast]);
    setTimeout(() => this.dismiss(toast.id), ms);
  }

  success(message: string, action?: Toast['action']): void {
    this.show(message, 'success', action);
  }

  error(message: string): void {
    this.show(message, 'error', undefined, 8000);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}
