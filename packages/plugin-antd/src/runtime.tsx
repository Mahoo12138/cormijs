import { ConfigProvider, theme as antdTheme } from 'antd';
import type { Locale } from 'antd/es/locale/index.js';
import * as arEGModule from 'antd/locale/ar_EG.js';
import * as deDEModule from 'antd/locale/de_DE.js';
import * as enUSModule from 'antd/locale/en_US.js';
import * as esESModule from 'antd/locale/es_ES.js';
import * as frFRModule from 'antd/locale/fr_FR.js';
import * as jaJPModule from 'antd/locale/ja_JP.js';
import * as koKRModule from 'antd/locale/ko_KR.js';
import * as ptBRModule from 'antd/locale/pt_BR.js';
import * as ruRUModule from 'antd/locale/ru_RU.js';
import * as zhCNModule from 'antd/locale/zh_CN.js';
import * as zhTWModule from 'antd/locale/zh_TW.js';
import type { ReactNode } from 'react';
import { useLocaleResource } from '@cormijs/runtime';
import type { AntdThemeOptions } from './index.js';

// Antd 6 locale files are CommonJS; bundlers expose the locale object as the namespace default.
const localeOf = (module: unknown): Locale => (module as { default?: Locale }).default ?? module as Locale;
const arEG = localeOf(arEGModule), deDE = localeOf(deDEModule), enUS = localeOf(enUSModule), esES = localeOf(esESModule);
const frFR = localeOf(frFRModule), jaJP = localeOf(jaJPModule), koKR = localeOf(koKRModule), ptBR = localeOf(ptBRModule);
const ruRU = localeOf(ruRUModule), zhCN = localeOf(zhCNModule), zhTW = localeOf(zhTWModule);
const locales = Object.freeze({ ar_EG: arEG, ar: arEG, de_DE: deDE, de: deDE, en_US: enUS, en: enUS, es_ES: esES, es: esES,
  fr_FR: frFR, fr: frFR, ja_JP: jaJP, ja: jaJP, ko_KR: koKR, ko: koKR, pt_BR: ptBR, pt: ptBR, ru_RU: ruRU, ru: ruRU,
  zh_CN: zhCN, zh: zhCN, zh_TW: zhTW, 'zh-Hant': zhTW });

export interface AntdProviderOptions {
  readonly theme?: AntdThemeOptions;
}
export interface AntdProviderProps {
  readonly options?: unknown;
  readonly children?: ReactNode;
}

/** Applies the active locale, direction and validated theme tokens to Antd. */
export function AntdProvider({ options, children }: AntdProviderProps) {
  const { resource, direction } = useLocaleResource(locales);
  const theme = (options as AntdProviderOptions | undefined)?.theme;
  return (
    <ConfigProvider
      locale={resource}
      direction={direction}
      theme={{ ...(theme?.token ? { token: theme.token } : {}), algorithm: theme?.dark === true ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}
    >
      {children}
    </ConfigProvider>
  );
}

export const antdRuntime = Object.freeze({ Provider: AntdProvider });
