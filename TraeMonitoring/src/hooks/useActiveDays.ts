import { useEffect, useState } from 'react';
import { ActiveDaysData } from '@/types';

type ElectronAPI = {
  getActiveDays?: () => Promise<ActiveDaysData | null>;
  refreshActiveDays?: () => Promise<ActiveDaysData | null>;
  getLoginStatus?: () => Promise<boolean>;
};

export const useActiveDays = () => {
  const [data, setData] = useState<ActiveDaysData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [invalidLogin, setInvalidLogin] = useState(false);

  useEffect(() => {
    let mounted = true;
    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI as ElectronAPI;
    const load = async () => {
      setLoading(true);
      const res = api && api.getActiveDays ? await api.getActiveDays() : null;
      const login = api && api.getLoginStatus ? await api.getLoginStatus() : !!res;
      if (mounted) {
        setData(res || null);
        setInvalidLogin(!login);
        setLastUpdated(Date.now());
        setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const refreshNow = async () => {
    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI as ElectronAPI;
    setLoading(true);
    const res = api && api.refreshActiveDays ? await api.refreshActiveDays() : null;
    const login = api && api.getLoginStatus ? await api.getLoginStatus() : !!res;
    setData(res || null);
    setInvalidLogin(!login);
    setLastUpdated(Date.now());
    setLoading(false);
  };

  return { data, loading, lastUpdated, invalidLogin, refreshNow };
};
