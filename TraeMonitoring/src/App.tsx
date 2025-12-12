import { useUsageData } from './hooks/useUsageData';
import { UsageDashboard } from './components/UsageDashboard';

function App() {
  const { data, refreshing, lastUpdated, invalidLogin } = useUsageData();

  return (
    <div className="w-full h-full relative">
      <UsageDashboard data={data} />
      {/* Refresh indicator */}
      <div className="absolute top-2 right-2 text-[10px]">
        {refreshing ? (
          <span className="px-2 py-1 rounded bg-accent/20 text-accent">正在刷新…</span>
        ) : (
          <span className="px-2 py-1 rounded bg-white/10">已刷新 {new Date(lastUpdated).toLocaleTimeString()}</span>
        )}
      </div>
      {invalidLogin && (
        <div className="absolute top-8 right-2 px-2 py-1 bg-red-600 text-white text-[10px] rounded">登录状态失效，请点击下方“重新登录”</div>
      )}
      <div className="absolute top-2 left-2 text-[10px]">
        <button
          className="px-2 py-1 rounded bg-white/10 border border-white/20 hover:bg-white/20"
          onClick={async () => {
            const api = (window as unknown as { electronAPI?: { openActiveWindow?: () => Promise<unknown> } }).electronAPI;
            if (api?.openActiveWindow) await api.openActiveWindow();
          }}
        >
          打开活跃看板窗口
        </button>
      </div>
    </div>
  );
}

export default App;
