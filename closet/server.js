const http = require('http');

const port = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'closet-node' }));
});

server.listen(port, () => {
  console.log(`Node service listening on http://localhost:${port}`);
});
