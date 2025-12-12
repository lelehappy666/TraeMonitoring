import React from 'react';
import { useActiveDays } from '@/hooks/useActiveDays';
import { cn } from '@/lib/utils';

export const ActiveDaysWindow: React.FC = () => {
  const { data, loading, refreshNow } = useActiveDays();

  React.useEffect(() => {
    const api = (window as unknown as { electronAPI?: { showLiveCalendar?: () => Promise<boolean> } }).electronAPI;
    const empty = !data || (Array.isArray(data.cells) && data.cells.length === 0);
    if (!loading && empty && api?.showLiveCalendar) {
      api.showLiveCalendar().catch(() => void 0);
    }
  }, [loading, data]);

  const handleRefresh = async () => {
    await refreshNow();
    const api = (window as unknown as { electronAPI?: { showLiveCalendar?: () => Promise<boolean> } }).electronAPI;
    if (api?.showLiveCalendar) {
      try { await api.showLiveCalendar(); } catch { /* noop */ }
    }
  };

  return (
    <div className={cn('flex flex-col h-screen bg-primary text-white select-none overflow-hidden drag-region')}> 
      <div className="h-6 flex items-center justify-end px-2 no-drag">
        <button
          className="text-[10px] px-2 py-1 rounded bg-white/10 border border-white/20 hover:bg-white/20"
          onClick={handleRefresh}
          disabled={loading}
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
    </div>
  );
};
