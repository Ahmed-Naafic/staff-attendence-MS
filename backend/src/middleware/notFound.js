export function notFound(req, res) {
  res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
}
