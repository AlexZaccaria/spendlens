import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18n } from '../core/i18n/i18n';
import { Delta } from './delta';

describe('Delta', () => {
  let fixture: ComponentFixture<Delta>;

  const render = async (inputs: Record<string, unknown>) => {
    fixture = TestBed.createComponent(Delta);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => TestBed.inject(I18n).lang.set('en'));

  it('marks more spending as bad, with the arrow and the figure', async () => {
    const el = await render({ current: 120, reference: 100 });
    const badge = el.querySelector('span')!;
    expect(badge.classList.contains('text-bad')).toBe(true);
    expect(badge.textContent).toContain('+20%');
  });

  it('marks more income as good when higher is better', async () => {
    const el = await render({ current: 80, reference: 100, higherIsBetter: true });
    expect(el.querySelector('span')!.classList.contains('text-bad')).toBe(true);
    const up = await render({ current: 130, reference: 100, higherIsBetter: true });
    expect(up.querySelector('span')!.classList.contains('text-good')).toBe(true);
  });

  it('shows an absolute difference for values that cross zero', async () => {
    const el = await render({ current: -5000, reference: 20000, higherIsBetter: true, currency: 'EUR' });
    expect(el.textContent).toContain('-€250');
  });

  it('renders nothing without a reference to compare with', async () => {
    const el = await render({ current: 100, reference: null });
    expect(el.textContent!.trim()).toBe('');
  });
});
