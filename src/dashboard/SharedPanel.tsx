import { IonButton } from '@ionic/react';
import { useEffect } from 'react';
import { formatCents, formatCentsWhole } from '../domain/money';
import { monthlyBreakdown, whoOwes } from '../domain/shared';
import { useHousehold } from '../household/HouseholdProvider';
import { useShared } from '../household/useShared';
import type { PanelProps } from './panels';

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** Who owes whom, plus the last few months of shared spending. */
export default function SharedPanel({ model }: PanelProps) {
  const { members } = useHousehold();
  const { ledger, refresh } = useShared();
  const [a, b] = members;

  // Refresh alongside the rest of the dashboard.
  useEffect(() => {
    void refresh();
  }, [model.data, refresh]);

  if (!a || !b) return <p className="caption">Add your partner in Settings to track shared expenses.</p>;
  if (!ledger) return <p className="caption">Loading…</p>;

  const name = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? 'Someone';
  const debt = whoOwes(ledger, a.user_id, b.user_id);
  const months = monthlyBreakdown(ledger, a.user_id, b.user_id).slice(0, 4);

  return (
    <div className="shared-panel" data-testid="shared-panel">
      <p className="balance-line">
        {debt ? (
          <>
            {name(debt.debtor)} owes {name(debt.creditor)} <strong>{formatCents(debt.cents)}</strong>
          </>
        ) : (
          "You're all square."
        )}
      </p>
      {months.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>{a.display_name} paid</th>
              <th>{b.display_name} paid</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <td>{monthFmt.format(new Date(`${m.month}T00:00:00Z`))}</td>
                <td>{formatCentsWhole(m.paidBy.get(a.user_id) ?? 0)}</td>
                <td>{formatCentsWhole(m.paidBy.get(b.user_id) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <IonButton size="small" fill="clear" routerLink="/shared">
        Details and paybacks
      </IonButton>
    </div>
  );
}
