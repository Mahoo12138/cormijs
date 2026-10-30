import React from 'react'

export type ServerInsertedHTMLHook = (callback: () => React.ReactNode) => void

/** Lets CSS-in-JS libraries inject `<style>` tags into the server-rendered `<head>`. */
export const ServerInsertedHTMLContext = React.createContext<ServerInsertedHTMLHook | null>(null)

/** No-op in the browser; during SSR the rendered nodes end up in `<head>`. */
export function useServerInsertedHTML(callback: () => React.ReactNode) {
  const addInsertedHTML = React.useContext(ServerInsertedHTMLContext)
  addInsertedHTML?.(callback)
}
