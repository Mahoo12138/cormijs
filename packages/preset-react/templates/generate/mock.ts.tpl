import { defineMock } from 'cormi';

export default defineMock({
  'GET /api/{{{ mockName }}}': (req, res) => {
    res.status(200).json({ name: '{{{ mockName }}}' });
  },
});
