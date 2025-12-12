import React from 'react';
import { Info } from 'lucide-react';
import { UsageItem } from '@/types';
import { cn } from '@/lib/utils';

interface UsageCardProps {
  item: UsageItem;
}

export const UsageCard: React.FC<UsageCardProps> = ({ item }) => {
  const percentage = Math.min((item.current / item.total) * 100, 100);
  const remaining = Math.max(item.total - item.current, 0).toFixed(2);

  return (
    <div className="py-4 border-b border-white/5 last:border-0">
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-medium break-words">{item.title}</span>
          {item.tag && (
            <span className="bg-green-900/30 text-accent text-[10px] px-1.5 py-0.5 rounded border border-accent/20">
              {item.tag}
            </span>
          )}
        </div>
        <div className="text-[10px] text-textSub opacity-80">
          {item.resetTime ? `重置时间：${item.resetTime}` : item.expiryTime ? `有效期至${item.expiryTime}` : ''}
        </div>
      </div>

      <div className="h-1.5 bg-gray-800 rounded-full mb-2 overflow-hidden">
        <div
          className={cn("h-full rounded-full", percentage > 0 ? "bg-accent" : "bg-transparent")}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex justify-between items-center text-xs">
        <div className="flex items-center gap-1">
          <span className="text-white font-bold">{item.current.toFixed(2)}</span>
          <span className="text-textSub">/ {item.total.toFixed(2)}</span>
          <Info size={12} className="text-textSub opacity-50 cursor-help hover:opacity-100 transition-opacity" />
        </div>
        <div className="text-textSub">
          剩余 <span className="text-white font-bold">{remaining}</span>
        </div>
      </div>
    </div>
  );
};
