import { createContext, useContext } from 'react';

export interface Preferences { title: string; description: string }
export const PreferencesContext = createContext<Preferences | null>(null);
export function usePreferences(): Preferences {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('应用配置尚未初始化');
  return value;
}
