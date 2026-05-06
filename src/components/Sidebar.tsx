import React from 'react';
import { LayoutGrid, Package, Settings, User } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

import { safeInvoke } from '../lib/utils';

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const [nickname, setNickname] = React.useState(localStorage.getItem('userNickname') || '');
  const [steamUser, setSteamUser] = React.useState<{ steam_id: string; persona_name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isBlinking, setIsBlinking] = React.useState(false);
  const [isSettingsHighlighted, setIsSettingsHighlighted] = React.useState(false);
  const [invalidNickname, setInvalidNickname] = React.useState(() => {
    const stored = localStorage.getItem('userNickname') || '';
    return /[^\x20-\x7E]/.test(stored) || stored.toLowerCase() === 'survivor';
  });
  const [buttons, setButtons] = React.useState<{name: string, url: string}[]>([]);
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState(false);

  React.useEffect(() => {
    const fetchSteamUser = async () => {
      try {
        const user = await safeInvoke<{ steam_id: string; persona_name: string }>('get_steam_user');
        setSteamUser(user);
        
        try {
          const avatar = await safeInvoke<string>('get_steam_avatar', { steamId: user.steam_id });
          if (avatar) setAvatarUrl(avatar);
        } catch (e) {
          console.warn('Failed to fetch Steam avatar:', e);
        }
      } catch (err) {
        console.error('Steam error:', err);
        setError(err as string);
      }
    };

    fetchSteamUser();

    const handleRequireNickname = () => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 2000);
    };

    const handleHighlightSettings = () => {
      setIsSettingsHighlighted(true);
      setTimeout(() => setIsSettingsHighlighted(false), 2000);
    };
    
    window.addEventListener('require-nickname', handleRequireNickname);
    window.addEventListener('highlight-settings', handleHighlightSettings);
    
    // Fetch external buttons config with fallbacks
    const GITHUB_CONFIG_URL = `https://raw.githubusercontent.com/Fourcade268/InfLauncher/refs/heads/main/servers.json?t=${Date.now()}`;
    const CF_CONFIG_URL = `https://inflauncher.pages.dev/servers.json?t=${Date.now()}`;
    const JSDELIVR_CONFIG_URL = `https://cdn.jsdelivr.net/gh/Fourcade268/InfLauncher@main/servers.json?t=${Date.now()}`;
    
    const loadConfig = async () => {
      const urls = [GITHUB_CONFIG_URL, JSDELIVR_CONFIG_URL, CF_CONFIG_URL, '/servers.json'];
      
      for (const url of urls) {
        try {
          const response = await fetch(url, {
            ...(url.startsWith('http') ? { cache: 'no-store' } : {}),
            signal: AbortSignal.timeout(3000)
          });
          const data = await response.json();
          if (data.Buttons) {
            setButtons(data.Buttons);
            return; // Success
          }
        } catch (err) {
          console.warn(`Failed to fetch buttons from ${url}:`, err);
        }
      }
      console.error('Failed to load buttons config from any source');
    };

    loadConfig();

    return () => {
      window.removeEventListener('require-nickname', handleRequireNickname);
      window.removeEventListener('highlight-settings', handleHighlightSettings);
    };
  }, []);

  const handleNicknameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const isInvalid = /[^\x20-\x7E]/.test(val) || val.toLowerCase() === 'survivor';
    setInvalidNickname(isInvalid);
    setNickname(val);
    localStorage.setItem('userNickname', val);
  };

  const navItems = [
    { id: 'servers', label: 'Серверы', icon: LayoutGrid },
    { id: 'mods', label: 'Моды', icon: Package },
    { id: 'settings', label: 'Настройки', icon: Settings },
  ];

  const handleCopySteamId = () => {
    if (steamUser?.steam_id) {
      navigator.clipboard.writeText(steamUser.steam_id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1000);
    }
  };

  return (
    <aside className="w-64 h-screen glass border-r border-fluent-border flex flex-col p-4 z-10">
      <div className="mb-8 px-2 flex justify-center">
        <img 
          src="/logo.svg" 
          alt="Influence Logo" 
          className="w-48 h-auto object-contain logo-invert"
          style={{ maxWidth: '192px' }}
        />
      </div>

      <nav className="flex-1 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                isActive 
                  ? "bg-white/10 text-white border-l-2 border-fluent-accent" 
                  : "text-gray-400 hover:bg-white/5 hover:text-white",
                (item.id === 'settings' && isSettingsHighlighted) && "animate-attention"
              )}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-4">
        {error && (
          <div className="px-2 py-1 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400">
            ⚠️ {error}
          </div>
        )}
        
        {buttons.length > 0 && (
          <div className="px-2 space-y-2 mb-4">
            {buttons.map((btn, idx) => (
              <button 
                key={idx} 
                onClick={() => safeInvoke('open_url', { url: btn.url })}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 text-gray-400 hover:bg-white/5 hover:text-white"
              >
                {btn.name}
              </button>
            ))}
          </div>
        )}

        <div className="px-2">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Ник на сервере
          </label>
          <input
            type="text"
            value={nickname}
            onChange={handleNicknameChange}
            placeholder="Введите ник..."
            className={cn(
              "w-full border rounded-md px-3 py-2 text-sm text-white focus:outline-none transition-all",
              isBlinking 
                ? "animate-error-blink border-red-500" 
                : invalidNickname
                  ? "bg-red-500/10 border-red-500 focus:ring-1 focus:ring-red-500"
                  : "bg-white/5 border-white/10 focus:ring-1 focus:ring-fluent-accent"
            )}
          />
        </div>

        <div className="pt-4 border-t border-white/10 flex items-center gap-3 px-2">
          <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-fluent-accent to-blue-600 flex items-center justify-center overflow-hidden border border-white/20">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : steamUser ? (
              <img 
                src={`https://api.dicebear.com/7.x/identicon/svg?seed=${steamUser.steam_id}`} 
                alt="Avatar" 
                className="w-full h-full object-cover"
              />
            ) : (
              <User size={20} className="text-white" />
            )}
          </div>
          <div className="flex flex-col overflow-hidden w-full">
            <span className="text-sm font-medium text-white truncate">
              {steamUser?.persona_name || 'Steam не запущен'}
            </span>
            <button 
              onClick={handleCopySteamId}
              disabled={!steamUser}
              className="text-left text-xs text-gray-400 font-mono truncate hover:text-white transition-colors disabled:hover:text-gray-500"
            >
              {copiedId ? 'Скопировано!' : (steamUser?.steam_id || 'Авторизация...')}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
