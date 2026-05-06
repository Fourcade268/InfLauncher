import React, { useState, useEffect } from 'react';
import { FolderSearch, Save, FolderOpen, Check } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { safeInvoke } from '../lib/utils';

const Settings: React.FC = () => {
  const [dayzPath, setDayzPath] = useState(localStorage.getItem('dayz_path') || '');
  const [launchParams, setLaunchParams] = useState(localStorage.getItem('launch_params') || '');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system');
  const [status, setStatus] = useState('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  const selectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Выберите папку с DayZ'
      });
      if (selected && typeof selected === 'string') {
        setDayzPath(selected);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const autoFindPath = async () => {
    try {
      const path = await safeInvoke<string>('find_dayz_path');
      if (path) {
        setDayzPath(path);
        setStatus('Путь найден автоматически!');
        setTimeout(() => setStatus(''), 3000);
      }
    } catch (e) {
      console.error(e);
      setStatus('Не удалось автоматически найти путь.');
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const saveSettings = () => {
    localStorage.setItem('dayz_path', dayzPath);
    localStorage.setItem('launch_params', launchParams);
    localStorage.setItem('theme', theme);
    window.dispatchEvent(new Event('theme-change'));
    setStatus('Настройки сохранены!');
    setTimeout(() => setStatus(''), 3000);
  };

  const [isPathValid, setIsPathValid] = useState(false);

  useEffect(() => {
    const validate = async () => {
      if (!dayzPath) {
        setIsPathValid(false);
        return;
      }
      const valid = await safeInvoke<boolean>('validate_dayz_path', { path: dayzPath });
      setIsPathValid(valid);
    };
    validate();
  }, [dayzPath]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Настройки</h1>
          <p className="text-white/40 text-sm mt-1">Конфигурация клиента и пути к игре</p>
        </div>
        {version && (
          <div className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg">
            <span className="text-xs font-bold text-white/30 uppercase tracking-widest mr-2">Версия</span>
            <span className="text-sm font-mono text-fluent-accent">{version}</span>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {/* Game Path */}
        <div className={`bg-white/5 border border-white/10 rounded-2xl p-6 transition-all duration-500 ${!isPathValid ? 'animate-inner-error border-red-500/50' : ''}`}>
          <label className="block text-sm font-medium text-white mb-2">Путь к DayZ</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={dayzPath}
              onChange={(e) => setDayzPath(e.target.value)}
              placeholder="Например: C:\Program Files (x86)\Steam\steamapps\common\DayZ"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-blue-500/50"
            />
            <div className="w-10 flex items-center justify-center">
              {isPathValid && (
                <div className="animate-checkmark-combined">
                  <Check className="w-6 h-6 text-emerald-500" />
                </div>
              )}
            </div>
            <button
              onClick={selectFolder}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl transition-colors text-sm"
            >
              <FolderOpen className="w-4 h-4" />
              Выбрать
            </button>
            <button
              onClick={autoFindPath}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl transition-colors text-sm"
            >
              <FolderSearch className="w-4 h-4" />
              Автопоиск
            </button>
          </div>
          <p className="text-xs text-white/30 mt-2">Папка, в которой находится установленная игра</p>
        </div>

        {/* Launch Params */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <label className="block text-sm font-medium text-white mb-2">Параметры запуска</label>
          <input
            type="text"
            value={launchParams}
            onChange={(e) => setLaunchParams(e.target.value)}
            placeholder="Например: -noPause -noSplash"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-blue-500/50"
          />
        </div>

        {/* Theme */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <label className="block text-sm font-medium text-white mb-2">Тема</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-blue-500/50 appearance-none"
          >
            <option value="system" className="theme-option">Как в системе</option>
            <option value="dark" className="theme-option">Тёмная</option>
            <option value="light" className="theme-option">Светлая</option>
          </select>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between">
          <p className="text-emerald-400 text-sm font-medium">{status}</p>
          <button
            onClick={saveSettings}
            className="flex items-center gap-2 bg-fluent-accent hover:bg-blue-600 text-white px-6 py-3 rounded-xl transition-colors font-medium shadow-lg shadow-fluent-accent/20"
          >
            <Save className="w-5 h-5" />
            Сохранить настройки
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
