const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from ECS Fargate!\n');
}).listen(80, () => console.log('Listening on port 80'));
