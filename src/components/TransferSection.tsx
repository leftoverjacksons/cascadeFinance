import {
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { formatDay } from '../domain/dates';
import { formatCents } from '../domain/money';
import type { LinkInfo } from '../household/useTransferLinks';
import { supabase } from '../lib/supabase';
import type { Transaction } from '../pages/TransactionsPage';

interface Candidate {
  id: string;
  account_id: string;
  posted_on: string;
  amount_cents: number;
  display_description: string;
  exact_amount: boolean;
  gap_days: number;
  already_linked: boolean;
}

interface Props {
  transaction: Transaction;
  link: LinkInfo | null;
  accountName: (id: string) => string;
  /** Called after linking, confirming or unlinking. */
  onChanged: () => void;
}

/** Transfer status of a transaction, with confirm / unlink / link-by-hand. */
export default function TransferSection({ transaction: t, link, accountName, onChanged }: Props) {
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  useEffect(() => {
    if (!picking) return;
    setCandidates(null);
    supabase.rpc('transfer_candidates', { p_txn: t.id }).then(({ data, error }) => {
      if (error) void toast({ message: error.message, duration: 4000, color: 'danger' });
      setCandidates((data as Candidate[]) ?? []);
    });
  }, [picking, t.id, toast]);

  async function run(op: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    const { error } = await op;
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 5000, color: 'danger' });
    else onChanged();
  }

  if (t.status === 'pending') return null;

  return (
    <IonList inset data-testid="transfer-section">
      <IonListHeader>Transfer</IonListHeader>
      {link ? (
        <>
          <IonItem>
            <IonLabel className="ion-text-wrap">
              <h3>
                {link.side === 'out' ? 'To' : 'From'} {accountName(link.peer.account_id)}
                {link.link.status === 'suggested' && (
                  <IonBadge color="warning" className="kind-badge">
                    check
                  </IonBadge>
                )}
              </h3>
              <p>
                {formatDay(link.peer.posted_on)} · {link.peer.display_description} · {formatCents(link.peer.amount_cents)}
              </p>
              {link.link.status === 'suggested' && (
                <p>Several transactions could be the other side; confirm this is the right one.</p>
              )}
            </IonLabel>
          </IonItem>
          <IonItem lines="none">
            {link.link.status === 'suggested' && (
              <IonButton
                size="small"
                disabled={busy}
                onClick={() => void run(supabase.rpc('confirm_transfer', { p_link: link.link.id }))}
              >
                Confirm
              </IonButton>
            )}
            <IonButton
              size="small"
              fill="outline"
              color="medium"
              disabled={busy}
              onClick={() => void run(supabase.rpc('unlink_transfer', { p_link: link.link.id }))}
            >
              Not a transfer pair (unlink)
            </IonButton>
          </IonItem>
        </>
      ) : (
        <IonItem button detail onClick={() => setPicking(true)}>
          <IonLabel className="ion-text-wrap">
            <h3>Link as a transfer…</h3>
            <p>Pair this with the matching transaction in another of your accounts.</p>
          </IonLabel>
        </IonItem>
      )}

      <IonModal isOpen={picking} onDidDismiss={() => setPicking(false)}>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => setPicking(false)}>Cancel</IonButton>
            </IonButtons>
            <IonTitle>Other side of the transfer</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <IonList data-testid="transfer-candidates">
            {candidates === null && (
              <IonItem>
                <IonNote>Looking…</IonNote>
              </IonItem>
            )}
            {candidates?.length === 0 && (
              <IonItem>
                <IonNote className="ion-text-wrap">
                  Nothing within 10 days in your other accounts. If the other account isn't imported yet, import it
                  first.
                </IonNote>
              </IonItem>
            )}
            {candidates?.map((c) => (
              <IonItem
                key={c.id}
                button
                detail={false}
                disabled={busy}
                onClick={() => {
                  setPicking(false);
                  void run(supabase.rpc('link_transfer', { p_a: t.id, p_b: c.id }));
                }}
              >
                <IonLabel className="ion-text-wrap">
                  <h3>
                    {accountName(c.account_id)} · {c.display_description}
                  </h3>
                  <p>
                    {formatDay(c.posted_on)} ({c.gap_days === 0 ? 'same day' : `${c.gap_days} day${c.gap_days === 1 ? '' : 's'} apart`})
                    {!c.exact_amount && ' · different amount'}
                    {c.already_linked && ' · currently linked elsewhere'}
                  </p>
                </IonLabel>
                <IonNote slot="end" className={c.amount_cents > 0 ? 'credit' : ''}>
                  {formatCents(c.amount_cents)}
                </IonNote>
              </IonItem>
            ))}
          </IonList>
        </IonContent>
      </IonModal>
    </IonList>
  );
}
