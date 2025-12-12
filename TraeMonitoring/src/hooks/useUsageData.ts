import { useState, useEffect, useRef } from 'react';
import { UsageData } from '@/types';

type ElectronAPI = {
  onUsageDataUpdate?: (cb: (data: unknown) => void) => void;
  getConfig?: () => Promise<{ refreshIntervalSeconds?: number }>;
  refreshNow?: () => Promise<UsageData | null>;
  updateRefreshInterval?: (seconds: number) => Promise<unknown>;
  removeListener?: (channel: string) => void;
};

const DEFAULT_DATA: UsageData = {
  planType: "—",
  resetDate: "—",
  daysRemaining: 0,
  items: []
};

export const useUsageData = () => {
  const [data, setData] = useState<UsageData>(DEFAULT_DATA);
  const [intervalMs, setIntervalMs] = useState<number>(5 * 60 * 1000);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [invalidLogin, setInvalidLogin] = useState(false);
  const hasDataRef = useRef<boolean>(false);

  useEffect(() => {
    let mounted = true;
    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI as ElectronAPI;

    const fetchReal = async () => {
      setRefreshing(true);
      if (api && api.getConfig) {
        const cfg = await api.getConfig();
        if (cfg?.refreshIntervalSeconds) {
          const ms = Math.max(1, Math.min(3600, cfg.refreshIntervalSeconds)) * 1000;
          if (ms !== intervalMs) setIntervalMs(ms);
        }
      }
      if (api && api.refreshNow) {
        const real = await api.refreshNow();
        if (!real) {
          if (mounted && !hasDataRef.current) {
            setInvalidLogin(true);
          }
        } else {
          setInvalidLogin(false);
          if (mounted) {
            setData(real as UsageData);
            hasDataRef.current = true;
          }
        }
      }
      if (mounted) {
        setLastUpdated(Date.now());
        setRefreshing(false);
      }
    };

    fetchReal();
    const interval = setInterval(fetchReal, intervalMs);

    if (api && api.onUsageDataUpdate) {
      api.onUsageDataUpdate((newData: unknown) => {
        if (mounted && newData) {
          setData(newData as UsageData);
          setLastUpdated(Date.now());
          setInvalidLogin(false);
          hasDataRef.current = true;
        }
      });
    }

    return () => {
      mounted = false;
      clearInterval(interval);
      if (api && api.removeListener) {
        api.removeListener('usage-data-update');
      }
    };
  }, [intervalMs]);

  return { data, refreshing, lastUpdated, invalidLogin };
};
