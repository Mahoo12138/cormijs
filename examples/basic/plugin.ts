import type { IApi } from 'cormi'

export default (api: IApi) => {
  api.addHTMLMetas(() => [{ name: 'generator', content: 'cormi' }])
  api.onStart(() => {
    api.logger.info('local plugin loaded')
  })
}
