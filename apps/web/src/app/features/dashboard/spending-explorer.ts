import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { getCategory, rootOf, type Summary, type Transaction } from '@spendlens/contracts';
import type { EChartsCoreOption } from 'echarts/core';
import { chargedAmount } from '../../core/amounts';
import { I18n } from '../../core/i18n/i18n';
import { slotVar } from '../../core/palette';
import { Theme } from '../../core/theme';
import { CategoryIcon } from '../../ui/category-icon';
import { Chart } from '../../ui/chart';
import { Delta } from '../../ui/delta';
import { Icon } from '../../ui/icon';
import { TransactionEditor } from '../transactions/transaction-editor';
import { buildSpendingTree, findPath, linesUnder, onlyLine, type SpendNode } from './spending-tree';

interface TileParams {
  readonly name: string;
  readonly value: number;
  readonly data?: { readonly id?: string };
}

const LIST_LIMIT = 8;
const TX_LIMIT = 6;

/**
 * Where the money goes, explorable: every click goes one level deeper — category → subcategory →
 * product (receipt items, summed across shops) or merchant → the single purchase (opened in the
 * editor). The treemap and the inspector next to
 * it always show the same node; the inspector is the keyboard- and screen-reader-friendly twin.
 */
@Component({
  selector: 'app-spending-explorer',
  imports: [Chart, CategoryIcon, Delta, Icon, RouterLink, TransactionEditor],
  templateUrl: './spending-explorer.html',
  host: { class: 'card flex flex-col p-5' },
})
export class SpendingExplorer {
  protected readonly i18n = inject(I18n);
  private readonly theme = inject(Theme);
  protected readonly t = this.i18n.t;

  readonly summary = input.required<Summary>();
  /** The month's expense transactions (the tree is built from them). */
  readonly transactions = input.required<readonly Transaction[]>();

  /** Back to the top whenever the month changes. */
  protected readonly focusId = linkedSignal({ source: () => this.summary().range.from, computation: () => 'all' });
  protected readonly editing = signal<Transaction | null>(null);
  protected readonly listLimit = LIST_LIMIT;
  protected readonly showAll = linkedSignal({ source: () => this.focusId(), computation: () => false });

  protected readonly tree = computed(() => buildSpendingTree(this.transactions(), this.i18n.lang(), this.t().dashboard.allSpending));
  protected readonly path = computed(() => findPath(this.tree(), this.focusId()) ?? [this.tree()]);
  protected readonly node = computed(() => this.path().at(-1)!);
  protected readonly parent = computed(() => this.path().at(-2) ?? null);

  protected readonly rows = computed(() => (this.node().level === 'group' ? [] : this.node().children));
  protected readonly shownRows = computed(() => (this.showAll() ? this.rows() : this.rows().slice(0, LIST_LIMIT)));
  /** Shares are of what the list shows, so they add up to 100% even when a discount nets the parent. */
  protected readonly rowsTotal = computed(() => this.rows().reduce((s, r) => s + r.totalMinor, 0) || 1);
  /** The single purchases under a product or a merchant. */
  protected readonly txList = computed(() => (this.node().level === 'group' ? linesUnder(this.node()) : []));
  protected readonly shownTx = computed(() => this.txList().slice(0, TX_LIMIT));

  /** Previous month's spending of the node, when the summary knows it (all spending, a category). */
  protected readonly previous = computed(() => {
    const n = this.node();
    const s = this.summary();
    if (n.level === 'all') return s.previous.expenseMinor || null;
    if (n.level === 'category') return s.categories.find((c) => c.id === n.id)?.previousMinor || null;
    return null;
  });

  /** Transactions page filtered on the node, for the full list. */
  protected readonly listLink = computed(() => {
    const n = this.node();
    const { from, to } = this.summary().range;
    const params: Record<string, string> = { from, to, kind: 'expense' };
    if (n.level !== 'all') params['category'] = n.level === 'category' ? n.id : n.categoryId;
    if (n.level === 'group') params['q'] = n.label;
    return params;
  });

  protected color(node: SpendNode): string {
    return slotVar(node.categoryId ? rootOf(node.categoryId).slot : null);
  }

  /** The node as charged, when all of it was charged in one currency other than the base. */
  protected original(node: SpendNode, whole = false): string | null {
    return chargedAmount(this.i18n, node.charged, this.summary().baseCurrency, { whole });
  }

  protected money(minor: number, whole = true): string {
    return this.i18n.money(minor, this.summary().baseCurrency, { whole });
  }

  /** Drill into a node — or open the transaction when there is nothing left to split. */
  protected select(node: SpendNode): void {
    const single = onlyLine(node);
    if (single?.transaction) this.editing.set(single.transaction);
    else this.focusId.set(node.id);
  }

  protected up(): void {
    const parent = this.parent();
    if (parent) this.focusId.set(parent.id);
  }

  protected onTile(event: unknown): void {
    const id = (event as TileParams).data?.id;
    const target = id ? findPath(this.tree(), id)?.at(-1) : null;
    if (target && target.id !== this.focusId()) this.select(target);
  }

  protected readonly ariaLabel = computed(() => {
    const n = this.node();
    const parts = n.children.map((c) => `${c.label} ${this.money(c.totalMinor)}`);
    return `${this.path().map((p) => p.label).join(' › ')}: ${parts.join(', ')}`;
  });

  protected readonly options = computed<EChartsCoreOption>(() => {
    const p = this.theme.palette();
    const focus = this.node();
    const total = focus.totalMinor || 1;
    const money = (v: number) => this.money(v);
    const depth = focus.level === 'group' ? 1 : 2;

    const tile = (n: SpendNode, level: number): Record<string, unknown> => {
      const slot = n.categoryId ? (getCategory(rootOf(n.categoryId).id)?.slot ?? 0) : 0;
      return {
        id: n.id,
        // A single purchase is told apart from its siblings by its date.
        name: n.level === 'line' && n.transaction ? `${this.i18n.date(n.transaction.date, 'short')} · ${n.label}` : n.label,
        value: n.totalMinor,
        itemStyle: { color: p.series[slot] },
        label: { color: p.onSeries[slot] },
        ...(level < depth && n.children.length > 0 && { children: n.children.map((c) => tile(c, level + 1)) }),
      };
    };

    return {
      aria: { enabled: false },
      tooltip: {
        backgroundColor: p.surface,
        borderColor: p.grid,
        textStyle: { color: p.ink, fontFamily: 'inherit' },
        formatter: (info: TileParams) =>
          `<div style="font-weight:600;font-size:15px">${money(info.value)}</div><div style="color:${p.ink2}">${escapeHtml(info.name)} · ${this.t().dashboard.shareOf(this.i18n.percent(info.value / total), escapeHtml(focus.label))}</div>`,
      },
      series: [
        {
          type: 'treemap',
          name: focus.label,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          animationDurationUpdate: 450,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          squareRatio: 0.75,
          visibleMin: 200,
          label: {
            show: true,
            overflow: 'truncate',
            fontFamily: 'inherit',
            formatter: (info: TileParams) => `{n|${info.name}}\n{v|${money(info.value)}}`,
            rich: { n: { fontSize: 12, lineHeight: 16 }, v: { fontSize: 13, fontWeight: 600, lineHeight: 18 } },
          },
          upperLabel: {
            show: true,
            height: 24,
            overflow: 'truncate',
            ellipsis: '…',
            padding: [0, 8, 0, 2],
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'inherit',
            color: p.ink,
            formatter: (info: TileParams) => `${info.name}  ${money(info.value)}`,
          },
          itemStyle: { borderColor: p.surface, gapWidth: 2, borderWidth: 0, borderRadius: 4 },
          emphasis: { itemStyle: { opacity: 0.88 }, upperLabel: { show: true } },
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 4 }, upperLabel: { show: false } },
            { itemStyle: { borderColor: 'transparent', borderWidth: 2, gapWidth: 2, borderRadius: 8 } },
            { itemStyle: { borderWidth: 0, gapWidth: 1, borderRadius: 4 } },
          ],
          data: focus.children.map((c) => tile(c, 1)),
        },
      ],
    };
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
