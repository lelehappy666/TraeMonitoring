export interface UsageItem {
  id: string;
  title: string;
  type: 'plan' | 'package';
  current: number;
  total: number;
  unit: string;
  resetTime?: string;
  expiryTime?: string;
  tag?: string;
}

export interface UsageData {
  planType: string;
  resetDate: string;
  daysRemaining: number;
  items: UsageItem[];
}

export interface AppConfig {
  refreshInterval: number; // minutes
  opacity: number; // 0-1
  alwaysOnTop: boolean;
  autoHide: boolean;
  windowPosition: { x: number; y: number };
}

export interface ActiveDayCell {
  date: string;
  level: number; // 0-4
  count?: number;
}

export interface ActiveDaysData {
  title: string; // 活跃看板
  months: string[];
  cells: ActiveDayCell[];
  gridHtml?: string;
}
