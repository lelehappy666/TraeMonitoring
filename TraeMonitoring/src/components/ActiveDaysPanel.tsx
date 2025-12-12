import React from 'react';
import { cn } from '@/lib/utils';
import { useActiveDays } from '@/hooks/useActiveDays';

const levelColor = (lv: number) => {
  if (lv <= 0) return '#1A1A1A';
  if (lv === 1) return '#134e4a';
  if (lv === 2) return '#166534';
  if (lv === 3) return '#1ea34a';
  return '#22C55E';
};

export const ActiveDaysPanel: React.FC = () => {
  const { data, loading, invalidLogin, refreshNow } = useActiveDays();
  const [lowPerf, setLowPerf] = React.useState(false);
  React.useEffect(() => {
    let frames = 0;
    let start = performance.now();
    let raf = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - start >= 2000) {
        const fps = (frames * 1000) / (now - start);
        setLowPerf(fps < 50);
        frames = 0;
        start = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const [pos, setPos] = React.useState({ x: 20, y: 80 });
  const [size, setSize] = React.useState({ w: 360, h: 220 });
  const draggingRef = React.useRef(false);
  const startRef = React.useRef({ x: 0, y: 0 });
  const resizeEdgeRef = React.useRef<null | 'left' | 'right' | 'top' | 'bottom'>(null);
  const frameRef = React.useRef<number | null>(null);

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    draggingRef.current = true;
    startRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const onMove = (ev: MouseEvent) => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const nx = ev.clientX - startRef.current.x;
        const ny = ev.clientY - startRef.current.y;
        const maxX = window.innerWidth - size.w;
        const maxY = window.innerHeight - size.h;
        setPos({ x: Math.max(0, Math.min(nx, maxX)), y: Math.max(0, Math.min(ny, maxY)) });
      });
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startResize = (edge: 'left' | 'right' | 'top' | 'bottom', e: React.MouseEvent) => {
    resizeEdgeRef.current = edge;
    const startX = e.clientX;
    const startY = e.clientY;
    const sw = size.w;
    const sh = size.h;
    const sp = { x: pos.x, y: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let w = sw, h = sh, x = sp.x, y = sp.y;
        if (edge === 'right') w = sw + dx;
        if (edge === 'bottom') h = sh + dy;
        if (edge === 'left') { w = sw - dx; x = sp.x + dx; }
        if (edge === 'top') { h = sh - dy; y = sp.y + dy; }
        const minW = 240, minH = 160;
        const maxW = Math.min(800, window.innerWidth);
        const maxH = Math.min(600, window.innerHeight);
        w = Math.max(minW, Math.min(maxW, Math.floor(w)));
        h = Math.max(minH, Math.min(maxH, Math.floor(h)));
        const maxX = window.innerWidth - w;
        const maxY = window.innerHeight - h;
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));
        setSize({ w, h });
        setPos({ x, y });
      });
    };
    const onUp = () => {
      resizeEdgeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const cells = data?.cells || [];

  return (
    <div
      className={cn('fixed z-50 no-drag rounded-lg border border-white/10 bg-secondary/40 text-white shadow-lg')}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 text-xs border-b border-white/10 cursor-move"
        onMouseDown={onHeaderMouseDown}
      >
        <div className="font-medium">{data?.title || '活跃看板'}</div>
        <button
          className="px-2 py-1 rounded bg-white/10 border border-white/20 hover:bg-white/20"
          onClick={refreshNow}
          disabled={loading}
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
      {invalidLogin && (
        <div className="px-3 py-2 text-[10px] text-red-500">登录状态失效或数据未获取，点击“刷新”后重试</div>
      )}
      <div className="p-3 h-[calc(100%-40px)] overflow-hidden">
        <div className="grid w-full h-full" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(8px, 1fr))', gap: lowPerf ? 1 : 2 }}>
          {cells.slice(0, lowPerf ? 300 : 400).map((c, i) => (
            <div
              key={(c.date || '') + '-' + i}
              className={cn("rounded", lowPerf ? "w-full h-2.5" : "w-full h-3")}
              title={c.date || ''}
              style={{ backgroundColor: levelColor(Number(c.level || 0)) }}
            />
          ))}
        </div>
        {loading && (
          <div className="absolute inset-0 bg-black/10 flex items-center justify-center text-[10px]">加载中…</div>
        )}
      </div>
      <div className="absolute top-0 left-0 w-1 h-full cursor-ew-resize" onMouseDown={(e) => startResize('left', e)} />
      <div className="absolute top-0 right-0 w-1 h-full cursor-ew-resize" onMouseDown={(e) => startResize('right', e)} />
      <div className="absolute top-0 left-0 w-full h-1 cursor-ns-resize" onMouseDown={(e) => startResize('top', e)} />
      <div className="absolute bottom-0 left-0 w-full h-1 cursor-ns-resize" onMouseDown={(e) => startResize('bottom', e)} />
    </div>
  );
};
