export default {
  'GET /api/hello': { message: 'hello from mock' },
  'POST /api/echo': (req: any, res: any) => {
    res.json({ body: req.body })
  },
}
