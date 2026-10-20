export default {
  'GET /api/users': { body: { users: ['Ada', 'Grace'] } },
  'POST /api/echo': request => ({ status: 201, body: request.body }),
  'GET /plain': { body: { plain: true } },
};
