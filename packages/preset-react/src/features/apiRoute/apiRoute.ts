import type { IApi } from '../../types.ts'

/**
 * API routes: every module under `src/api` handles `/api/...`.
 *
 * ```ts
 * // src/api/users/[id].ts
 * export async function GET(request: Request, { params }) {
 *   return Response.json({ id: params.id })
 * }
 * // or umi style
 * export default async function (req: CormiApiRequest, res: CormiApiResponse) {
 *   res.status(200).json({ id: req.params.id })
 * }
 * ```
 *
 * They run in the dev server, `cormi preview` and the production server
 * (`cormi serve` / `@cormi/server`), through the generated `server.ts`.
 */
export default (api: IApi) => {
  api.describe({
    key: 'apiRoute',
    config: {
      schema: ({ zod }) => zod.object({ platform: zod.string() }).partial(),
    },
  })

  api.onStart(() => {
    const count = Object.keys(api.appData.apiRoutes ?? {}).length
    if (count) api.logger.info(`Found ${count} API route${count > 1 ? 's' : ''} in ${api.paths.absApiRoutesPath}`)
  })
}
