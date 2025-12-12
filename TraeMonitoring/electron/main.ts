import { app, BrowserWindow, screen, ipcMain, shell, BrowserView } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';
import cheerio from 'cheerio';
import fsPromises from 'fs/promises';
import { chromium } from 'playwright';

type UsageItem = { id: string; title: string; type: 'plan'|'package'; current: number; total: number; unit: string; tag?: string };
type UsageData = { planType: string; resetDate: string; daysRemaining: number; items: UsageItem[] };
type ActiveDayCell = { date: string; level: number; count?: number };
type ActiveDaysData = { title: string; months: string[]; cells: ActiveDayCell[]; gridHtml?: string };

// Disable GPU Acceleration for Windows 7
if (process.platform === 'win32') app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let currentUsage: UsageData | null = null;
let lastUpdate = 0;
let isRefreshing = false;
let isResizing = false;
let currentActive: ActiveDaysData | null = null;
let lastActiveUpdate = 0;
let activeWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development';
const configPath = path.join(app.getPath('userData'), 'window-state.json');
const appConfigPath = path.join(app.getPath('userData'), 'app-config.json');
const appProfileDir = path.join(app.getPath('userData'), 'playwright-profile');

function saveWindowState(window: BrowserWindow) {
  if (!window) return;
  const bounds = window.getBounds();
  try {
    fs.writeFileSync(configPath, JSON.stringify(bounds));
  } catch (e) {
    console.error('Failed to save window state:', e);
  }
}

function loadWindowState() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load window state:', e);
  }
  return null;
}

type AppConfig = {
  refreshIntervalSeconds: number;
};

function loadAppConfig(): AppConfig {
  try {
    if (fs.existsSync(appConfigPath)) {
      return JSON.parse(fs.readFileSync(appConfigPath, 'utf-8')) as AppConfig;
    }
  } catch { void 0 }
  const def: AppConfig = { refreshIntervalSeconds: 300 };
  try { fs.writeFileSync(appConfigPath, JSON.stringify(def)); } catch { void 0 }
  return def;
}

function saveAppConfig(cfg: Partial<AppConfig>) {
  const current = loadAppConfig();
  const next = { ...current, ...cfg };
  try { fs.writeFileSync(appConfigPath, JSON.stringify(next)); } catch { void 0 }
  return next;
}

function createWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 680;
  // Default position: Top Right
  const defaultX = screenWidth - windowWidth - 20;
  const defaultY = 20;

  const savedBounds = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: 420,
    x: savedBounds?.x ?? defaultX,
    y: savedBounds?.y ?? defaultY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true, // As per tech doc
    resizable: true,
    movable: true, // Handled by drag region
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5180');
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('moved', () => {
    if (!mainWindow) return;
    const work = screen.getPrimaryDisplay().workArea;
    const b = mainWindow.getBounds();
    const nx = Math.min(Math.max(b.x, work.x), work.x + work.width - b.width);
    const ny = Math.min(Math.max(b.y, work.y), work.y + work.height - b.height);
    if (nx !== b.x || ny !== b.y) {
      mainWindow.setBounds({ x: nx, y: ny, width: b.width, height: b.height });
    }
    saveWindowState(mainWindow);
  });
}

function createActiveWindow() {
  if (activeWindow) {
    activeWindow.focus();
    return;
  }
  activeWindow = new BrowserWindow({
    width: 1120,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    movable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (isDev) {
    activeWindow.loadURL('http://localhost:5180/#active');
  } else {
    const fileUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).toString() + '#active';
    activeWindow.loadURL(fileUrl);
  }
  activeWindow.on('closed', () => {
    activeWindow = null;
  });
  activeWindow.on('resize', () => {
    const views = activeWindow?.getBrowserViews() || [];
    if (views.length > 0 && activeWindow) {
      const b = activeWindow.getBounds();
      views[0].setBounds({ x: 8, y: 24, width: Math.max(100, b.width - 16), height: Math.max(60, b.height - 32) });
    }
  });
}
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


async function withPlaywrightContext(userDataDir: string, headless = true) {
  try {
    const ctx = await chromium.launchPersistentContext(userDataDir, { headless });
    return ctx;
  } catch { void 0 }
  try {
    const ctx = await chromium.launchPersistentContext(userDataDir, { headless, channel: 'chrome' });
    return ctx;
  } catch { void 0 }
  try {
    const ctx = await chromium.launchPersistentContext(userDataDir, { headless, channel: 'msedge' });
    return ctx;
  } catch { void 0;
    return null;
  }
}

function extractUsageFromJson(json: unknown): UsageData | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;

  const candidates: Array<{ current?: number; total?: number; title?: string; type?: 'plan'|'package'; unit?: string }> = [];

  const tryPush = (title: string, cur?: unknown, tot?: unknown, unit = '次', type: 'plan'|'package' = 'package') => {
    const current = typeof cur === 'number' ? cur : Number(cur);
    const total = typeof tot === 'number' ? tot : Number(tot);
    if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
      candidates.push({ title, current, total, unit, type });
    }
  };

  if (typeof j.limit === 'number' || typeof j.used === 'number') {
    tryPush('使用量', j.used, j.limit, '次', 'plan');
  }
  if (typeof j.total === 'number' || typeof j.current === 'number') {
    tryPush('使用量', j.current, j.total, '次', 'plan');
  }

  for (const key of Object.keys(j)) {
    const val = j[key];
    if (val && typeof val === 'object') {
      const o = val as Record<string, unknown>;
      if ('used' in o || 'limit' in o || 'total' in o || 'current' in o) {
        tryPush(key, o.used ?? o.current, o.limit ?? o.total, '次', key.includes('plan') ? 'plan' : 'package');
      }
      if (Array.isArray(o.items)) {
        for (const it of o.items as unknown[]) {
          if (it && typeof it === 'object') {
            const io = it as Record<string, unknown>;
            tryPush((io.title as string) || key, io.used ?? io.current, io.limit ?? io.total, '次', (io.type as 'plan'|'package') || 'package');
          }
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  const items: UsageItem[] = candidates.map((c, idx) => ({
    id: (c.title || '用量') + '-' + idx,
    title: c.title || '用量',
    type: c.type || 'package',
    current: c.current ?? 0,
    total: c.total ?? 0,
    unit: c.unit || '次',
  }));
  return {
    planType: '专业版套餐',
    resetDate: '',
    daysRemaining: 0,
    items,
  };
}

async function extractUsageDataFromPage(page: import('playwright').Page): Promise<UsageData | null> {
  try {
    const result = await page.evaluate(() => {
      const raw = document.body.innerText || '';
      const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
      const items: { id: string; title: string; type: 'plan'|'package'; current: number; total: number; unit: string; tag?: string; resetTime?: string; expiryTime?: string }[] = [];
      const ratioRegex = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/;

      let planType = '';
      let resetDate = '';
      let daysRemaining = 0;
      const planMatch = raw.match(/You are on\s+(.+?)\s+plan/i);
      if (planMatch) planType = planMatch[1].trim();
      const daysMatch = raw.match(/Usage reset in\s+(\d+)\s+days/i);
      if (daysMatch) daysRemaining = parseInt(daysMatch[1] || '0', 10);
      const resetDateMatch = raw.match(/on\s+(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})/);
      if (resetDateMatch) resetDate = resetDateMatch[1].trim();
      const resetHeaderCn = raw.match(/使用量将于(\d{4}年\s*\d{1,2}月\s*\d{1,2}日\s*\d{2}:\d{2})重置/);
      if (resetHeaderCn && !resetDate) resetDate = resetHeaderCn[1].trim();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(ratioRegex);
        if (!m) continue;
        const current = parseFloat(m[1] || '0');
        const total = parseFloat(m[2] || '0');

        let title = '';
        let resetTime: string | undefined;
        let expiryTime: string | undefined;
        let tag: string | undefined;

        for (let k = i - 1; k >= Math.max(0, i - 5); k--) {
          const t = lines[k];
          if (/Pro plan|Extra package|计划|套餐|礼包/i.test(t)) { title = t; break; }
          if (!/\d/.test(t) && t.length > 0 && t.length <= 60 && !/Left|Expire|Reset/i.test(t)) { title = t; break; }
        }
        for (let k = i - 3; k <= Math.min(lines.length - 1, i + 3); k++) {
          const t = lines[k];
          const rm = t.match(/Reset at\s+(.+)/i);
          const em = t.match(/Expire at\s+(.+)/i);
          if (rm && !resetTime) resetTime = rm[1].trim();
          if (em && !expiryTime) expiryTime = em[1].trim();
          if (/Consuming/i.test(t)) tag = 'Consuming';
          if (/消费/.test(t)) tag = '消费';
        }

        if (!title) title = 'Usage';
        const type: 'plan'|'package' = /Pro plan|专业计划|计划/i.test(title) ? 'plan' : 'package';
        items.push({ id: title + '-' + i, title, type, current, total, unit: '次', tag, resetTime, expiryTime });
        if (items.length >= 10) break;
      }
      return { planType, resetDate, daysRemaining, items };
    });
    if (!result) return null;
    if (result.items.length === 0 && !result.resetDate) return null;
    return result;
  } catch {
    return null;
  }
}

async function parseUsageFromPage(page: import('playwright').Page): Promise<UsageData | null> {
  try {
    let apiUsage: UsageData | null = null;
    page.on('response', async (res) => {
      try {
        const u = res.url();
        const ct = (await res.headerValue('content-type')) || '';
        if (/usage|quota|plan|account/i.test(u) && ct.includes('application/json')) {
          const json = await res.json();
          const parsed = extractUsageFromJson(json);
          if (parsed) apiUsage = parsed;
        }
      } catch { void 0 }
    });

    await page.goto('https://www.trae.ai/account-setting#usage', { waitUntil: 'domcontentloaded' });
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { void 0 }
    const url = page.url();
    if (!/account-setting/.test(url)) return null;

    try {
      const fromDoc = await page.evaluate(() => {
        const parseJsonSafe = (txt: string | null): unknown => {
          if (!txt) return null;
          try { return JSON.parse(txt); } catch { return null; }
        };
        const nextNode = document.getElementById('__NEXT_DATA__');
        const next = parseJsonSafe(nextNode?.textContent || '');
        const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
        const jsons = scripts.map(s => parseJsonSafe(s.textContent || '')).filter(Boolean);
        return { next, jsons };
      });
      if (fromDoc) {
        const { next, jsons } = fromDoc as { next: unknown; jsons: unknown[] };
        const viaNext = next ? (typeof next === 'object' ? next : null) : null;
        if (viaNext) {
          const parsed = extractUsageFromJson(viaNext);
          if (parsed && parsed.items.length > 0) return parsed;
        }
        for (const j of jsons || []) {
          const parsed = extractUsageFromJson(j);
          if (parsed && parsed.items.length > 0) return parsed;
        }
      }
    } catch { void 0 }

    if (apiUsage && apiUsage.items.length > 0) return apiUsage;
    return await extractUsageDataFromPage(page);
  } catch { void 0;
    return null;
  }
}

type AnyObject = Record<string, unknown>;

async function extractActiveDaysFromPage(page: import('playwright').Page): Promise<ActiveDaysData | null> {
  try {
    const res = await page.evaluate(() => {
      const textContainer = (() => {
        const titleNode = Array.from(document.querySelectorAll('h1,h2,h3,div,span')).find(el => /Active\s*Days|活跃日|活跃看板/i.test(el.textContent || ''));
        let p = titleNode ? titleNode.parentElement : null;
        for (let i=0;i<5 && p;i++){ if (p.querySelectorAll('div,section').length>0) return p; p = p.parentElement; }
        return null;
      })();
      const gridContainer = document.getElementById('calendarGrid')
        || document.querySelector('[id*="calendarGrid"],[class*="calendarGrid"],[role="grid"]')
        || textContainer
        || document.body;
      const toDateKey = (s: string) => {
        if (!s) return '';
        const m1 = String(s).match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
        if (m1) return m1[1] + '-' + m1[2] + '-' + m1[3];
        const m2 = String(s).match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
        if (m2){
          const dd = String(m2[1]).padStart(2,'0');
          const months: Record<string,string> = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
          const mm = months[m2[2].slice(0,3).toLowerCase()] || '01';
          return m2[3] + '-' + mm + '-' + dd;
        }
        return '';
      };
      const levelFrom = (el: Element) => {
        const dl = Number(el.getAttribute('data-level'));
        if (Number.isFinite(dl)) return dl;
        const cls = el.className ? String((el as HTMLElement).className) : '';
        const cm = cls.match(/level[-_\s]?(\d)/i);
        if (cm) return Number(cm[1]);
        const style = getComputedStyle(el as HTMLElement);
        const bg = style.backgroundColor || '';
        const m = bg.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        if (m){
          const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
          const v = Math.max(r,g,b);
          return v < 40 ? 0 : v < 80 ? 1 : v < 120 ? 2 : v < 160 ? 3 : 4;
        }
        return NaN;
      };
      const countFrom = (el: Element) => {
        const dc = el.getAttribute('data-count');
        if (dc && /^\d+$/.test(dc)) return Number(dc);
        const aria = el.getAttribute('aria-label') || '';
        const m = aria.match(/(\d+)\s*(activity|次|条|events?)/i);
        if (m) return Number(m[1]);
        return NaN;
      };
      const candidates = Array.from(gridContainer.querySelectorAll('[data-date],[aria-label],[title],rect,[role="gridcell"],div,span'));
      const map = new Map<string, { date: string; level: number; count?: number }>();
      for (const el of candidates){
        const rawDate = (el.getAttribute('data-date') || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
        const date = toDateKey(rawDate);
        if (!date) continue;
        const level = levelFrom(el);
        const count = countFrom(el);
        const prev = map.get(date);
        if (!prev) {
          map.set(date, { date, level: Number.isFinite(level) ? level : 0, count: Number.isFinite(count) ? count : undefined });
        } else {
          const lv = Number.isFinite(level) ? level : prev.level;
          const ct = Number.isFinite(count) ? count : prev.count;
          map.set(date, { date, level: lv, count: ct });
        }
      }
      if (map.size === 0) {
        const rows = Array.from(gridContainer.querySelectorAll('[class*="weekRow"],[style*="top:"]')) as HTMLElement[];
        const uniqRows = rows.map(r => ({ el: r, top: parseFloat(r.style.top || '0') })).sort((a,b) => a.top - b.top);
        const msDay = 24 * 60 * 60 * 1000;
        const today = new Date();
        const dow = (today.getDay() + 6) % 7;
        const baseMonday = new Date(today.getTime() - dow * msDay);
        const levelFromIcon = (el: Element) => {
          const rect = el.querySelector('svg rect');
          const fill = rect?.getAttribute('fill') || '';
          const op = Number(rect?.getAttribute('fill-opacity') || rect?.getAttribute('opacity') || '1');
          const mHex = fill.match(/#([0-9a-fA-F]{6})/);
          if (mHex) {
            const h = mHex[1];
            const r = parseInt(h.slice(0,2), 16);
            const g = parseInt(h.slice(2,4), 16);
            const b = parseInt(h.slice(4,6), 16);
            const v = Math.max(r,g,b) * (Number.isFinite(op) ? op : 1);
            return v < 40 ? 0 : v < 80 ? 1 : v < 120 ? 2 : v < 160 ? 3 : 4;
          }
          const mRgb = fill.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
          if (mRgb) {
            const r = Number(mRgb[1]), g = Number(mRgb[2]), b = Number(mRgb[3]);
            const v = Math.max(r,g,b) * (Number.isFinite(op) ? op : 1);
            return v < 40 ? 0 : v < 80 ? 1 : v < 120 ? 2 : v < 160 ? 3 : 4;
          }
          return NaN;
        };
        for (let ri = 0; ri < uniqRows.length; ri++) {
          const rowEl = uniqRows[ri].el;
          const cells = Array.from(rowEl.querySelectorAll('[class*="calendarDay"],div,span')) as HTMLElement[];
          const lefts = cells.map(c => parseFloat(c.style.left || '0')).filter(v => Number.isFinite(v)).sort((a,b) => a - b);
          const step = lefts.length > 1 ? Math.min(...lefts.slice(1).map((v,i) => v - lefts[i])) || 16 : 16;
          for (const cell of cells) {
            const left = parseFloat(cell.style.left || '0');
            const col = Number.isFinite(left) ? Math.round(left / step) : 0;
            const dateObj = new Date(baseMonday.getTime() - (uniqRows.length - 1 - ri) * 7 * msDay + col * msDay);
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            const date = y + '-' + m + '-' + d;
            const level = levelFromIcon(cell);
            const prev = map.get(date);
            const lv = Number.isFinite(level) ? level : (prev ? prev.level : 0);
            map.set(date, { date, level: lv, count: prev?.count });
          }
        }
      }
      const gridEl = document.querySelector('.section-SqHrr3')
        || document.querySelector('.calendarGrid-CKzXol')
        || document.getElementById('calendarGrid')
        || document.querySelector('[class*="calendarGrid"],[role="grid"]');
      const gridHtml = gridEl ? (gridEl as HTMLElement).outerHTML : '';
      return { cells: Array.from(map.values()), gridHtml };
    });
    if (res && Array.isArray(res.cells) && res.cells.length > 0) return { title: '活跃看板', months: [], cells: res.cells, gridHtml: res.gridHtml };
    if (res && typeof res.gridHtml === 'string' && res.gridHtml.length > 0) return { title: '活跃看板', months: [], cells: [], gridHtml: res.gridHtml };
    return null;
  } catch {
    return null;
  }
}

async function fetchActiveDays(): Promise<ActiveDaysData | null> {
  try {
    const url = 'https://www.trae.ai/account-setting#profile';
    let hidden: BrowserWindow | null = null;
    try {
      hidden = new BrowserWindow({ show: false, webPreferences: { offscreen: false, backgroundThrottling: false } });
      await hidden.loadURL(url);
      try { await hidden.webContents.executeJavaScript('document.readyState'); } catch { /* noop */ }
      await new Promise(r => setTimeout(r, 3500));
      const html = await hidden.webContents.executeJavaScript('document.documentElement.outerHTML');
      const $ = cheerio.load(html);
      // Try NEXT_DATA
      const nextTxt = $('#__NEXT_DATA__').text();
      const cellsFromNext = (() => {
        try { const j = JSON.parse(nextTxt); return extractActiveCellsFromJson(j); } catch { return []; }
      })();
      if (cellsFromNext.length > 0) return { title: '活跃看板', months: [], cells: cellsFromNext };
      // Try other JSON scripts
      const scripts = $('script[type="application/json"]').map((_i, el) => $(el).text()).get();
      for (const txt of scripts) {
        try {
          const j = JSON.parse(txt);
          const cells = extractActiveCellsFromJson(j);
          if (cells.length > 0) return { title: '活跃看板', months: [], cells };
        } catch { /* noop */ }
      }
      // Try SVG rects
      const rects = $('rect');
      const cellsSvg: ActiveDayCell[] = [];
      rects.each((_i, el) => {
        const date = $(el).attr('data-date') || $(el).attr('aria-label') || $(el).attr('title') || '';
        const levelStr = $(el).attr('data-level') || '';
        const countStr = $(el).attr('data-count') || '';
        const fill = $(el).attr('fill') || '';
        let level = Number(levelStr);
        if (!Number.isFinite(level) && fill) {
          const hex = fill.match(/#([0-9a-fA-F]{6})/);
          if (hex) {
            const h = hex[1];
            const r = parseInt(h.slice(0,2), 16);
            const g = parseInt(h.slice(2,4), 16);
            const b = parseInt(h.slice(4,6), 16);
            const v = Math.max(r, g, b);
            level = v < 40 ? 0 : v < 80 ? 1 : v < 120 ? 2 : v < 160 ? 3 : 4;
          } else {
            const rgb = fill.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
            if (rgb) {
              const r = Number(rgb[1]), g = Number(rgb[2]), b = Number(rgb[3]);
              const v = Math.max(r, g, b);
              level = v < 40 ? 0 : v < 80 ? 1 : v < 120 ? 2 : v < 160 ? 3 : 4;
            }
          }
        }
        const count = Number(countStr);
        if (date && (Number.isFinite(level) || Number.isFinite(count))) {
          cellsSvg.push({ date: String(date), level: Number.isFinite(level) ? level : 0, count: Number.isFinite(count) ? count : undefined });
        }
      });
      if (cellsSvg.length > 0) return { title: '活跃看板', months: [], cells: cellsSvg };
      const domCells = await hidden.webContents.executeJavaScript(String.raw`(function(){
        const textContainer = (() => {
          const titleNode = Array.from(document.querySelectorAll('h1,h2,h3,div,span')).find(el => /Active\s*Days|活跃日|活跃看板/i.test(el.textContent || ''));
          let p = titleNode ? titleNode.parentElement : null;
          for (let i=0;i<5 && p;i++){ if (p.querySelectorAll('div,section').length>0) return p; p = p.parentElement; }
          return null;
        })();
        const gridContainer = document.getElementById('calendarGrid')
          || document.querySelector('.calendarGrid-CKzXol')
          || document.querySelector('[id*="calendarGrid"],[class*="calendarGrid"],[role="grid"]')
          || textContainer
          || document.body;
        const toDateKey = (s) => {
          if (!s) return '';
          const m1 = String(s).match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
          if (m1) return m1[1] + '-' + m1[2] + '-' + m1[3];
          const m2 = String(s).match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
          if (m2){
            const dd = String(m2[1]).padStart(2,'0');
            const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
            const mm = months[m2[2].slice(0,3).toLowerCase()] || '01';
            return m2[3] + '-' + mm + '-' + dd;
          }
          return '';
        };
        const levelFrom = (el) => {
          const dl = Number(el.getAttribute('data-level'));
          if (Number.isFinite(dl)) return dl;
          const cls = el.className ? String(el.className) : '';
          const cm = cls.match(/level[-_\s]?(\d)/i);
          if (cm) return Number(cm[1]);
          const style = getComputedStyle(el);
          const bg = style.backgroundColor || '';
          const m = bg.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
          if (m){
            const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
            const v = Math.max(r,g,b);
            return v < 40 ? 0 : v < 80 ? 1 : v < 120 ? 2 : v < 160 ? 3 : 4;
          }
          const rect = el.querySelector('svg rect');
          const fill = rect?.getAttribute('fill') || '';
          const op = Number(rect?.getAttribute('fill-opacity') || rect?.getAttribute('opacity') || '1');
          const mHex = fill.match(/#([0-9a-fA-F]{6})/);
          if (mHex) {
            const h = mHex[1];
            const r = parseInt(h.slice(0,2), 16);
            const g = parseInt(h.slice(2,4), 16);
            const b = parseInt(h.slice(4,6), 16);
            const v = Math.max(r,g,b) * (Number.isFinite(op) ? op : 1);
            return v < 40 ? 0 : v < 80 ? 1 : v < 120 ? 2 : v < 160 ? 3 : 4;
          }
          const mRgb = fill.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
          if (mRgb) {
            const r = Number(mRgb[1]), g = Number(mRgb[2]), b = Number(mRgb[3]);
            const v = Math.max(r,g,b) * (Number.isFinite(op) ? op : 1);
            return v < 40 ? 0 : v < 80 ? 1 : v < 120 ? 2 : v < 160 ? 3 : 4;
          }
          return NaN;
        };
        const countFrom = (el) => {
          const dc = el.getAttribute('data-count');
          if (dc && /^\d+$/.test(dc)) return Number(dc);
          const aria = el.getAttribute('aria-label') || '';
          const m = aria.match(/(\d+)\s*(activity|次|条|events?)/i);
          if (m) return Number(m[1]);
          return NaN;
        };
        const candidates = Array.from(gridContainer.querySelectorAll('[data-date],[aria-label],[title],rect,[role="gridcell"],div,span'));
        const map = new Map();
        for (const el of candidates){
          const rawDate = (el.getAttribute('data-date') || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
          const date = toDateKey(rawDate);
          if (!date) continue;
          const level = levelFrom(el);
          const count = countFrom(el);
          const prev = map.get(date);
          if (!prev) {
            map.set(date, { date, level: Number.isFinite(level) ? level : 0, count: Number.isFinite(count) ? count : undefined });
          } else {
            const lv = Number.isFinite(level) ? level : prev.level;
            const ct = Number.isFinite(count) ? count : prev.count;
            map.set(date, { date, level: lv, count: ct });
          }
        }
        if (map.size === 0) {
          const rows = Array.from(gridContainer.querySelectorAll('[class*="weekRow"],[style*="top:"]'));
          const uniqRows = rows.map(r => ({ el: r, top: parseFloat((r as HTMLElement).style.top || '0') })).sort((a,b) => a.top - b.top);
          const msDay = 24 * 60 * 60 * 1000;
          const today = new Date();
          const dow = (today.getDay() + 6) % 7;
          const baseMonday = new Date(today.getTime() - dow * msDay);
          for (let ri = 0; ri < uniqRows.length; ri++) {
            const rowEl = uniqRows[ri].el as HTMLElement;
            const cells = Array.from(rowEl.querySelectorAll('[class*="calendarDay"],div,span')) as HTMLElement[];
            const lefts = cells.map(c => parseFloat(c.style.left || '0')).filter(v => Number.isFinite(v)).sort((a,b) => a - b);
            const step = lefts.length > 1 ? Math.min(...lefts.slice(1).map((v,i) => v - lefts[i])) || 16 : 16;
            for (const cell of cells) {
              const left = parseFloat(cell.style.left || '0');
              const col = Number.isFinite(left) ? Math.round(left / step) : 0;
              const dateObj = new Date(baseMonday.getTime() - (uniqRows.length - 1 - ri) * 7 * msDay + col * msDay);
              const y = dateObj.getFullYear();
              const m = String(dateObj.getMonth() + 1).padStart(2, '0');
              const d = String(dateObj.getDate()).padStart(2, '0');
              const date = y + '-' + m + '-' + d;
              const level = levelFrom(cell);
              const prev = map.get(date);
              const lv = Number.isFinite(level) ? level : (prev ? prev.level : 0);
              map.set(date, { date, level: lv, count: prev?.count });
            }
          }
        }
        return Array.from(map.values());
      })()`);
      if (Array.isArray(domCells) && domCells.length > 0) {
        const gridHtml = await hidden.webContents.executeJavaScript(`(function(){
          const el = document.querySelector('.section-SqHrr3')
            || document.querySelector('.calendarGrid-CKzXol')
            || document.getElementById('calendarGrid')
            || document.querySelector('[class*="calendarGrid"],[role="grid"]');
          return el ? el.outerHTML : '';
        })()`);
        return { title: '活跃看板', months: [], cells: domCells, gridHtml: typeof gridHtml === 'string' ? gridHtml : '' };
      }
      const gridHtmlOnly = await hidden.webContents.executeJavaScript(`(function(){
        const el = document.querySelector('.section-SqHrr3')
          || document.querySelector('.calendarGrid-CKzXol')
          || document.getElementById('calendarGrid')
          || document.querySelector('[class*="calendarGrid"],[role="grid"]');
        return el ? el.outerHTML : '';
      })()`);
      if (typeof gridHtmlOnly === 'string' && gridHtmlOnly.length > 0) return { title: '活跃看板', months: [], cells: [], gridHtml: gridHtmlOnly };
      return null;
    } finally {
      try { hidden?.destroy(); } catch { /* noop */ }
    }
  } catch {
    return null;
  }
}

function extractActiveCellsFromJson(json: unknown): ActiveDayCell[] {
  const arr: ActiveDayCell[] = [];
  const normalizeDate = (d: unknown): string => {
    if (typeof d === 'number' && Number.isFinite(d)) {
      const ms = d > 1e12 ? d : d * 1000;
      const dt = new Date(ms);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
    const s = String(d || '');
    return s;
  };
  const pushCell = (date: unknown, level: unknown, count?: unknown) => {
    const d = normalizeDate(date);
    const lv = Number(level);
    const ct2 = count !== undefined ? Number(count) : undefined;
    if (d && (Number.isFinite(lv) || Number.isFinite(ct2 as number))) {
      arr.push({ date: d, level: Number.isFinite(lv) ? lv : 0, count: ct2 });
    }
  };
  const walk = (obj: unknown) => {
    if (!obj) return;
    if (Array.isArray(obj)) {
      if (obj.length === 2 && typeof obj[0] !== 'object' && typeof obj[1] === 'number') {
        pushCell(obj[0] as unknown, undefined, obj[1] as unknown);
        return;
      }
      obj.forEach(walk);
      return;
    }
    if (typeof obj === 'object') {
      const o = obj as { date?: unknown; day?: unknown; dt?: unknown; timestamp?: unknown; createdAt?: unknown; level?: unknown; intensity?: unknown; value?: unknown; count?: unknown; times?: unknown; frequency?: unknown } & AnyObject;
      const date = o.date ?? o.day ?? o.dt ?? o.timestamp ?? o.createdAt;
      const level = o.level ?? o.intensity ?? o.value;
      const count = o.count ?? o.times ?? o.frequency;
      if (date !== undefined && (level !== undefined || count !== undefined)) {
        pushCell(date, level, count);
      }
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (v !== undefined) walk(v);
      }
    }
  };
  try { walk(json); } catch { void 0 }
  return arr;
}

async function parseUsageFromHtml(html: string): Promise<UsageData> {
  const $ = cheerio.load(html);
  const raw = $('body').text();
  const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
  const items: { id: string; title: string; type: 'plan'|'package'; current: number; total: number; unit: string; tag?: string; resetTime?: string; expiryTime?: string }[] = [];
  const ratioRegex = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/;

  let planType = '';
  let resetDate = '';
  let daysRemaining = 0;
  const planMatch = raw.match(/You are on\s+(.+?)\s+plan/i);
  if (planMatch) planType = planMatch[1].trim();
  const daysMatch = raw.match(/Usage reset in\s+(\d+)\s+days/i);
  if (daysMatch) daysRemaining = parseInt(daysMatch[1] || '0', 10);
  const resetDateMatch = raw.match(/on\s+(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})/);
  if (resetDateMatch) resetDate = resetDateMatch[1].trim();
  const resetHeaderCn = raw.match(/使用量将于(\d{4}年\s*\d{1,2}月\s*\d{1,2}日\s*\d{2}:\d{2})重置/);
  if (resetHeaderCn && !resetDate) resetDate = resetHeaderCn[1].trim();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(ratioRegex);
    if (!m) continue;

    const current = parseFloat(m[1] || '0');
    const total = parseFloat(m[2] || '0');

    let title = '';
    let resetTime: string | undefined;
    let expiryTime: string | undefined;
    let tag: string | undefined;

    for (let k = i - 1; k >= Math.max(0, i - 5); k--) {
      const t = lines[k];
      if (/Pro plan|Extra package|计划|套餐|礼包/i.test(t)) { title = t; break; }
      if (!/\d/.test(t) && t.length > 0 && t.length <= 60 && !/Left|Expire|Reset/i.test(t)) { title = t; break; }
    }
    for (let k = i - 3; k <= Math.min(lines.length - 1, i + 3); k++) {
      const t = lines[k];
      const rm = t.match(/Reset at\s+(.+)/i);
      const em = t.match(/Expire at\s+(.+)/i);
      if (rm && !resetTime) resetTime = rm[1].trim();
      if (em && !expiryTime) expiryTime = em[1].trim();
      if (/Consuming/i.test(t)) tag = 'Consuming';
      if (/消费/.test(t)) tag = '消费';
    }

    if (!title) title = 'Usage';
    const type: 'plan'|'package' = /Pro plan|专业计划|计划/i.test(title) ? 'plan' : 'package';
    items.push({ id: title + '-' + i, title, type, current, total, unit: '次', tag, resetTime, expiryTime });
    if (items.length >= 10) break;
  }

  return { planType: planType || '—', resetDate, daysRemaining, items };
}

async function fetchTraeUsage(): Promise<UsageData | null> {
  const cookie = process.env.TRAE_COOKIE;
  const url = 'https://www.trae.ai/account-setting#usage';
  try {
    if (!fs.existsSync(appProfileDir)) {
      try { await fsPromises.mkdir(appProfileDir, { recursive: true }); } catch { void 0 }
    }
    const ctx2 = await withPlaywrightContext(appProfileDir, true);
    if (ctx2) {
      const page = await ctx2.newPage();
      const viaAppProfile = await parseUsageFromPage(page);
      await ctx2.close();
      if (viaAppProfile) return viaAppProfile;
    }

    if (cookie) {
      const res = await fetch(url, { headers: { cookie } });
      const html = await res.text();
      return await parseUsageFromHtml(html);
    }
    const hidden = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: true } });
    await hidden.loadURL(url);
    await hidden.webContents.executeJavaScript('document.readyState');
    const html = await hidden.webContents.executeJavaScript('document.documentElement.outerHTML');
    const data = await parseUsageFromHtml(html);
    hidden.destroy();
    return data;
  } catch {
    return null;
  }
}

ipcMain.handle('get-usage-data', async () => {
  if (currentUsage) return currentUsage;
  const data = await fetchTraeUsage();
  if (data) {
    currentUsage = data;
    lastUpdate = Date.now();
  }
  return currentUsage;
});

ipcMain.handle('get-config', async () => {
  return loadAppConfig();
});

ipcMain.handle('update-refresh-interval', async (_e, seconds: number) => {
  const next = saveAppConfig({ refreshIntervalSeconds: Math.max(1, Math.min(3600, seconds)) });
  return next;
});

ipcMain.handle('get-window-bounds', async () => {
  if (!mainWindow) return null;
  return mainWindow.getBounds();
});

ipcMain.handle('set-window-size', async (_e, size: { width: number; height: number }) => {
  if (!mainWindow) return false;
  const work = screen.getPrimaryDisplay().workArea;
  const b = mainWindow.getBounds();
  const minW = 360, minH = 300, maxW = Math.min(1200, work.width), maxH = Math.min(900, work.height);
  const width = Math.max(minW, Math.min(maxW, Math.floor(size.width)));
  const height = Math.max(minH, Math.min(maxH, Math.floor(size.height)));
  if (width !== b.width || height !== b.height) {
    mainWindow.setBounds({ x: b.x, y: b.y, width, height });
  }
  if (!isResizing) saveWindowState(mainWindow);
  return true;
});

ipcMain.on('set-window-position', (_e, pos: { x: number; y: number }) => {
  if (!mainWindow) return;
  const work = screen.getPrimaryDisplay().workArea;
  const b = mainWindow.getBounds();
  const x = Math.min(Math.max(pos.x, work.x), work.x + work.width - b.width);
  const y = Math.min(Math.max(pos.y, work.y), work.y + work.height - b.height);
  mainWindow.setBounds({ x, y, width: b.width, height: b.height });
  if (!isResizing) saveWindowState(mainWindow);
});

ipcMain.on('set-resizing', (_e, flag: boolean) => {
  isResizing = !!flag;
  if (!isResizing && mainWindow) {
    // commit final bounds after resize ends
    saveWindowState(mainWindow);
  }
});
ipcMain.handle('reset-login', async () => {
  try {
    if (!fs.existsSync(appProfileDir)) {
      try { await fsPromises.mkdir(appProfileDir, { recursive: true }); } catch { /* noop */ }
    }
    const ctx = await withPlaywrightContext(appProfileDir, false);
    if (!ctx) return false;
    const page = await ctx.newPage();
    await page.goto('https://www.trae.ai/account-setting#usage', { waitUntil: 'domcontentloaded' });

    const startTime = Date.now();
    const timeout = 120000;
    let success = false;
    while (Date.now() - startTime < timeout) {
      if (page.isClosed()) break;
      let data: UsageData | null = null;
      let act: ActiveDaysData | null = null;
      try {
        const fromDoc = await page.evaluate(() => {
          const parseJsonSafe = (txt: string | null): unknown => {
            if (!txt) return null;
            try { return JSON.parse(txt); } catch { return null; }
          };
          const nextNode = document.getElementById('__NEXT_DATA__');
          const next = parseJsonSafe(nextNode?.textContent || '');
          const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
          const jsons = scripts.map(s => parseJsonSafe(s.textContent || '')).filter(Boolean);
          return { next, jsons };
        });
        if (fromDoc) {
          const { next, jsons } = fromDoc as { next: unknown; jsons: unknown[] };
          const viaNext = next ? (typeof next === 'object' ? next : null) : null;
          if (viaNext) {
            const parsed = extractUsageFromJson(viaNext);
            if (parsed && parsed.items.length > 0) data = parsed;
          }
          if (!data) {
            for (const j of jsons || []) {
              const parsed = extractUsageFromJson(j);
              if (parsed && parsed.items.length > 0) { data = parsed; break; }
            }
          }
        }
        if (!data) {
          const raw = await extractUsageDataFromPage(page);
          if (raw && raw.items.length > 0) data = raw;
        }
      } catch { /* noop */ }

      if (!(data && data.items.length > 0)) {
        try {
          const cookies = await ctx.cookies(['https://www.trae.ai/']);
          const hasTrae = cookies.some(c => /trae\.ai$/i.test(c.domain));
          if (hasTrae) {
            const fetched = await fetchTraeUsage();
            if (fetched && fetched.items.length > 0) {
              data = fetched;
            }
            try {
              await page.goto('https://www.trae.ai/account-setting#profile', { waitUntil: 'domcontentloaded' });
              try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { /* noop */ }
              act = await extractActiveDaysFromPage(page);
            } catch { /* noop */ }
          }
        } catch { /* noop */ }
      }

      if (data && data.items.length > 0) {
        currentUsage = data;
        lastUpdate = Date.now();
        if (mainWindow) mainWindow.webContents.send('usage-data-update', currentUsage);
        if (!act) {
          try {
            await page.goto('https://www.trae.ai/account-setting#profile', { waitUntil: 'domcontentloaded' });
            try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { /* noop */ }
            act = await extractActiveDaysFromPage(page);
          } catch { /* noop */ }
        }
        if (act && act.cells.length > 0) {
          currentActive = act;
          lastActiveUpdate = Date.now();
        }
        success = true;
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    try { await ctx.close(); } catch { /* noop */ }
    return success;
  } catch { void 0;
    return false;
  }
});

ipcMain.on('open-external', (_e, url: string) => {
  try { shell.openExternal(url); } catch { /* noop */ }
});

ipcMain.handle('refresh-now', async () => {
  if (isRefreshing || isResizing) return currentUsage;
  const now = Date.now();
  const minGap = 5000;
  if (currentUsage && now - lastUpdate < minGap) return currentUsage;
  isRefreshing = true;
  const data = await fetchTraeUsage();
  if (data) {
    currentUsage = data;
    lastUpdate = Date.now();
    if (mainWindow) mainWindow.webContents.send('usage-data-update', currentUsage);
  }
  isRefreshing = false;
  return currentUsage;
});

ipcMain.handle('get-active-days', async () => {
  const now = Date.now();
  const ttl = 60 * 60 * 1000;
  if (currentActive && now - lastActiveUpdate < ttl) {
    return currentActive;
  }
  const data = await fetchActiveDays();
  if (data) {
    currentActive = data;
    lastActiveUpdate = now;
  }
  return currentActive;
});

ipcMain.handle('refresh-active-days', async () => {
  currentActive = null;
  lastActiveUpdate = 0;
  const data = await fetchActiveDays();
  if (data) {
    currentActive = data;
    lastActiveUpdate = Date.now();
  }
  return currentActive;
});

ipcMain.handle('open-active-window', async () => {
  createActiveWindow();
  return true;
});

ipcMain.handle('show-live-calendar', async () => {
  try {
    if (!activeWindow) return false;
    const views = activeWindow.getBrowserViews();
    let view = views[0];
    if (!view) {
      view = new BrowserView({ webPreferences: { nodeIntegration: false, contextIsolation: true } });
      activeWindow.setBrowserView(view);
    }
    const b = activeWindow.getBounds();
    view.setBounds({ x: 8, y: 24, width: Math.max(100, b.width - 16), height: Math.max(60, b.height - 32) });
    await view.webContents.loadURL('https://www.trae.ai/account-setting#profile');
    try {
      await view.webContents.executeJavaScript(`(function(){
        const prefer = '.section-SqHrr3';
        let tries = 0;
        const maxTries = 12;
        function attempt(){
          const el = document.querySelector(prefer);
          if (!el) {
            if (++tries < maxTries) { setTimeout(attempt, 500); }
            return false;
          }
          const wrapper = document.createElement('div');
          wrapper.style.position = 'absolute';
          wrapper.style.inset = '0';
          wrapper.style.overflow = 'auto';
          wrapper.appendChild(el.cloneNode(true));
          document.body.innerHTML = '';
          document.body.appendChild(wrapper);
          return true;
        }
        return attempt();
      })();`);
    } catch { /* noop */ }
    return true;
  } catch { /* noop */
    return false;
  }
});

ipcMain.handle('get-login-status', async () => {
  return !!(currentUsage || currentActive);
});
