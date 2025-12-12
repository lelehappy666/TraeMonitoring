import React from 'react';
import { Zap } from 'lucide-react';
import { UsageData } from '@/types';
import { UsageCard } from './UsageCard';
import { cn } from '@/lib/utils';

interface UsageDashboardProps {
  data: UsageData;
}

export const UsageDashboard: React.FC<UsageDashboardProps> = ({ data }) => {
  const [showIntervalDialog, setShowIntervalDialog] = React.useState(false);
  const [secondsInput, setSecondsInput] = React.useState('300');
  const [isLoggingIn, setIsLoggingIn] = React.useState(false);
  const [translatedItems, setTranslatedItems] = React.useState(data.items);

  const translate = (t: string) => {
    const s = t.trim();
    if (/^Pro\s*plan$/i.test(s)) return '专业计划';
    if (/^Extra\s*package\s*\(Official bonus\)$/i.test(s)) return '额外礼包（官方奖励）';
    if (/^Extra\s*package$/i.test(s)) return '额外包裹';
    if (/^Consuming$/i.test(s)) return '消费中';
    return s;
  };

  React.useEffect(() => {
    const items = (data.items || []).map((it) => ({
      ...it,
      title: translate(it.title),
      tag: it.tag ? translate(it.tag) : undefined,
    }));
    const withRemaining = items.map((it) => ({ item: it, r: Math.max(it.total - it.current, 0) }));
    const positive = withRemaining.filter((i) => i.r > 0).sort((a, b) => b.r - a.r);
    const nonPositive = withRemaining.filter((i) => i.r <= 0).sort((a, b) => b.r - a.r);
    setTranslatedItems([...positive, ...nonPositive].map(({ item }) => item));
  }, [data.items]);

  const handleRelogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = (window as any).electronAPI;
    if (api && api.resetLogin) {
      await api.resetLogin();
    }
    setIsLoggingIn(false);
  };

  const handleOpenInterval = () => {
    setShowIntervalDialog(true);
  };

  const handleSaveInterval = async () => {
    const val = Number(secondsInput);
    if (!Number.isFinite(val)) return;
    if (val < 1 || val > 3600) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = (window as any).electronAPI;
    if (api && api.updateRefreshInterval) {
      await api.updateRefreshInterval(val);
    }
    setShowIntervalDialog(false);
  };

  const startResize = async (edge: 'left' | 'right' | 'top' | 'bottom', e: React.MouseEvent) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = (window as any).electronAPI;
    if (!api || !api.getWindowBounds || !api.setWindowSize) return;
    const bounds = await api.getWindowBounds();
    if (!bounds) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = bounds.width;
    const startH = bounds.height;
    const startPos = { x: bounds.x, y: bounds.y };
    if (api.setResizing) api.setResizing(true);
    let rafId: number | null = null;
    let pending: { width: number; height: number; pos?: { x: number; y: number } } | null = null;
    const schedule = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (!pending) return;
        const p = pending; pending = null;
        // fire-and-forget to avoid blocking UI thread
        try { api.setWindowSize(p); } catch { /* noop */ }
        if (p.pos && api.setWindowPosition) { try { api.setWindowPosition(p.pos); } catch { /* noop */ } }
      });
    };
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (edge === 'right') {
        pending = { width: startW + dx, height: startH };
      } else if (edge === 'bottom') {
        pending = { width: startW, height: startH + dy };
      } else if (edge === 'left') {
        const nextW = startW - dx;
        pending = { width: nextW, height: startH, pos: { x: startPos.x + dx, y: startPos.y } };
      } else if (edge === 'top') {
        const nextH = startH - dy;
        pending = { width: startW, height: nextH, pos: { x: startPos.x, y: startPos.y + dy } };
      }
      schedule();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (rafId != null) window.cancelAnimationFrame(rafId);
      if (api.setResizing) api.setResizing(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className={cn("flex flex-col h-screen bg-primary text-white p-5 select-none overflow-hidden border border-white/10 rounded-lg drag-region relative")}>
      {/* Header */}
      <div className="mb-4 cursor-move">
        <h1 className="text-2xl font-bold mb-1">用量</h1>
        <p className="text-xs text-textSub">
          您目前使用的是<span className="text-white font-medium mx-1">{translate(data.planType)}</span>。
          使用量将于{data.resetDate}重置，共<span className="text-white font-medium mx-1">{data.daysRemaining}天</span>。
        </p>
      </div>

      {/* Quick Request Section Header */}
      <div className="flex items-center gap-1.5 mb-3 text-sm font-medium text-white">
        <Zap size={16} className="text-accent fill-accent" />
        <span>快速请求</span>
        <span className="text-textSub opacity-50 text-[10px] border border-textSub rounded-full w-3.5 h-3.5 flex items-center justify-center cursor-help">i</span>
      </div>

      {/* Usage Cards Container */}
      <div className="flex-1 bg-secondary/30 rounded-lg border border-white/5 p-4 overflow-y-auto scroll-smooth mb-4 custom-scrollbar no-drag">
        <div className="flex flex-col gap-4 min-w-[360px]">
          {translatedItems.map((item) => (
            <UsageCard key={item.id} item={item} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto pt-1 flex justify-end items-center no-drag">
        <div className="flex items-center gap-3">
          <button onClick={handleRelogin} disabled={isLoggingIn} className="h-8 px-4 rounded border border-white/20 bg-white/10 text-white text-xs font-medium hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-wait">
            {isLoggingIn ? '登录中...' : '重新登录'}
          </button>
          <button onClick={handleOpenInterval} className="h-8 px-4 rounded border border-white/20 bg-white/10 text-white text-xs font-medium hover:bg-white/20 transition-colors">
            设置刷新时间
          </button>
        </div>
      </div>

      {showIntervalDialog && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center no-drag">
          <div className="bg-secondary rounded-lg border border-white/10 p-4 w-[280px]">
            <h3 className="text-sm font-medium mb-2">设置刷新间隔（秒）</h3>
            <input
              className="w-full bg-primary border border-white/10 rounded px-2 py-1 text-sm mb-3 outline-none"
              type="number"
              min={1}
              max={3600}
              value={secondsInput}
              onChange={(e) => setSecondsInput(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowIntervalDialog(false)} className="text-xs px-3 py-1 bg-white/10 border border-white/20 rounded">取消</button>
              <button onClick={handleSaveInterval} className="text-xs px-3 py-1 bg-white text-black rounded">保存</button>
            </div>
          </div>
        </div>
      )}
      <div className="absolute top-0 left-0 w-1 h-full cursor-ew-resize no-drag" onMouseDown={(e) => startResize('left', e)} />
      <div className="absolute top-0 right-0 w-1 h-full cursor-ew-resize no-drag" onMouseDown={(e) => startResize('right', e)} />
      <div className="absolute top-0 left-0 w-full h-1 cursor-ns-resize no-drag" onMouseDown={(e) => startResize('top', e)} />
      <div className="absolute bottom-0 left-0 w-full h-1 cursor-ns-resize no-drag" onMouseDown={(e) => startResize('bottom', e)} />
    </div>
  );
};
