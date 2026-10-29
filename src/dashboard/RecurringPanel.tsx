import { IonButton } from '@ionic/react';
import { useEffect } from 'react';
import { formatDay, todayLocal } from '../domain/dates';
import { formatCents, formatCentsWhole } from '../domain/money';
import { useRecurring } from '../household/useRecurring';
import type { PanelProps } from './panels';

const UPCOMING_DAYS = 30;
const SHOW = 6;

/** Recurring charges: the monthly total and what is due in the next 30 days. */
export default function RecurringPanel({ model }: PanelProps) {
  const { series, refresh } = useRecurring();

  // Refresh alongside the rest of the dashboard.
  useEffect(() => {
    void refresh();
  }, [model.data, refresh]);

  if (!series) return <p className="caption">Looking for recurring charges…</p>;
  const active = series.filter((s) => !s.overdue);
  const monthly = active.reduce((t, s) => t + s.monthlyCents, 0);
  const until = new Date(Date.parse(todayLocal()) + UPCOMING_DAYS * 86_400_000).toISOString().slice(0, 10);
  const upcoming = active.filter((s) => s.next <= until).sort((a, b) => a.next.localeCompare(b.next));

  return (
    <div className="recurring-panel" data-testid="recurring-panel">
      <p className="balance-line">
        About <strong>{formatCentsWhole(monthly)}</strong> a month in {active.length} recurring charge
        {active.length === 1 ? '' : 's'}
      </p>
      {upcoming.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Due in the next {UPCOMING_DAYS} days</th>
              <th>Expected</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.slice(0, SHOW).map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td>{formatDay(s.next).replace(/^\w+, /, '')}</td>
                <td>
                  {s.varies && '~'}
                  {formatCents(s.typicalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <IonButton size="small" fill="clear" routerLink="/recurring">
        All recurring charges
      </IonButton>
    </div>
  );
}
