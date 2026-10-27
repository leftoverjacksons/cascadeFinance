// Desktop-only tiled dashboard. Loaded lazily (see OverviewPage) so phones
// never download the grid library.
import { IonButton, IonIcon, useIonActionSheet, useIonToast } from '@ionic/react';
import { close } from 'ionicons/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useAuth } from '../auth/AuthProvider';
import type { Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import {
  addPanel,
  COLS,
  DEFAULT_LAYOUT,
  hiddenPanels,
  MIN_H,
  MIN_W,
  removePanel,
  ROWS_PER_SCREEN,
  sanitizeLayout,
  toSaved,
  type LayoutItem,
} from './layout';
import type { DashboardModel } from './model';
import { PANEL_BY_ID, PANELS } from './panels';

const Grid = WidthProvider(GridLayout);
const KNOWN = PANELS.map((p) => p.id);
const MARGIN = 12;
const SAVE_DELAY_MS = 800;

/** Row height so that ROWS_PER_SCREEN rows fill the space below the header. */
function useRowHeight(container: React.RefObject<HTMLDivElement>) {
  const [rowHeight, setRowHeight] = useState(40);
  useEffect(() => {
    function measure() {
      const top = container.current?.getBoundingClientRect().top ?? 120;
      const available = window.innerHeight - top - MARGIN;
      setRowHeight(Math.max(28, Math.floor((available - MARGIN * (ROWS_PER_SCREEN + 1)) / ROWS_PER_SCREEN)));
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [container]);
  return rowHeight;
}

export default function Workspace({ model, onDataChanged }: { model: DashboardModel; onDataChanged: () => void }) {
  const { session } = useAuth();
  const userId = session!.user.id;
  const [items, setItems] = useState<LayoutItem[] | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const rowHeight = useRowHeight(container);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const [actions] = useIonActionSheet();
  const [toast] = useIonToast();

  // Load this person's saved layout (or the default).
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('user_preferences')
      .select('dashboard_layout')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => !cancelled && setItems(sanitizeLayout(data?.dashboard_layout ?? null, KNOWN)));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const save = useCallback(
    (next: LayoutItem[]) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const { error } = await supabase
          .from('user_preferences')
          .upsert({ user_id: userId, dashboard_layout: toSaved(next, KNOWN) as unknown as Json });
        if (error) void toast({ message: `Layout not saved: ${error.message}`, duration: 4000, color: 'danger' });
      }, SAVE_DELAY_MS);
    },
    [userId, toast],
  );
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function update(next: LayoutItem[]) {
    setItems(next);
    save(next);
  }

  if (!items) return null;
  const hidden = hiddenPanels(items, KNOWN);

  function onLayoutChange(layout: Layout[]) {
    const next = layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    const same =
      items!.length === next.length &&
      next.every((n) => items!.some((o) => o.i === n.i && o.x === n.x && o.y === n.y && o.w === n.w && o.h === n.h));
    if (!same) update(next);
  }

  return (
    <div className="workspace" ref={container}>
      <div className="workspace-actions">
        <IonButton
          size="small"
          fill="outline"
          disabled={hidden.length === 0}
          onClick={() =>
            void actions({
              header: 'Add panel',
              buttons: [
                ...hidden.map((id) => ({ text: PANEL_BY_ID.get(id)!.title, handler: () => update(addPanel(items, id)) })),
                { text: 'Cancel', role: 'cancel' },
              ],
            })
          }
        >
          Add panel{hidden.length > 0 && ` (${hidden.length})`}
        </IonButton>
        <IonButton size="small" fill="clear" onClick={() => update(DEFAULT_LAYOUT.filter((it) => KNOWN.includes(it.i)))}>
          Reset layout
        </IonButton>
        <span className="hint">Drag a panel by its title; resize from its bottom-right corner.</span>
      </div>
      <Grid
        layout={items.map((it) => ({ ...it, minW: MIN_W, minH: MIN_H }))}
        cols={COLS}
        rowHeight={rowHeight}
        margin={[MARGIN, MARGIN]}
        containerPadding={[0, 0]}
        draggableHandle=".panel-drag"
        draggableCancel=".panel-close"
        resizeHandles={['se']}
        onLayoutChange={onLayoutChange}
      >
        {items.map((it) => {
          const panel = PANEL_BY_ID.get(it.i)!;
          const { Body } = panel;
          return (
            <section key={it.i} className="panel" data-panel={it.i}>
              <header className="panel-header">
                <div className="panel-drag" title="Drag to move">
                  <h2>{panel.title}</h2>
                  {panel.caption && <p className="caption">{panel.caption(model)}</p>}
                </div>
                <button
                  className="panel-close"
                  aria-label={`Hide ${panel.title}`}
                  onClick={() => update(removePanel(items, it.i))}
                >
                  <IonIcon icon={close} />
                </button>
              </header>
              <div className="panel-body">
                <Body model={model} fill onDataChanged={onDataChanged} />
              </div>
            </section>
          );
        })}
      </Grid>
    </div>
  );
}
